import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSerialStore } from "@/stores/serialStore";
import { useLogStore } from "@/stores/logStore";
import type { ColorParserConfig } from "@/lib/rttColorParser";
import { parseColoredSegments } from "@/lib/coloredSegments";
import { writeSerialData, writeSerialText } from "@/lib/serialSend";
import type { LineEnding } from "@/lib/serialTypes";
import { loadSendHistory, pushSendHistory } from "@/lib/serialHistory";
import { exportTextAsTxt } from "@/lib/exporters";
import { useSaveTxtContextMenu } from "@/components/ui/save-txt-context-menu";
import { copyTextToClipboard } from "@/lib/viewerCopy";
import { useShallow } from "zustand/react/shallow";

interface SerialTerminalViewerProps {
  title?: string;
}

interface TerminalDisplayLine {
  id: number;
  text: string;
  isActive: boolean;
}

/** 稳定的空引用，避免无活动行时每次渲染都生成新数组。 */
const EMPTY_TAIL_LINES: TerminalDisplayLine[] = [];

const ARROW_KEY_BYTES: Record<string, number[]> = {
  ArrowUp: [0x1b, 0x5b, 0x41],
  ArrowDown: [0x1b, 0x5b, 0x42],
  ArrowRight: [0x1b, 0x5b, 0x43],
  ArrowLeft: [0x1b, 0x5b, 0x44],
};

function getLineEndingText(lineEnding: LineEnding) {
  switch (lineEnding) {
    case "cr":
      return "\r";
    case "crlf":
      return "\r\n";
    case "none":
      return "";
    case "lf":
    default:
      return "\n";
  }
}

export function SerialTerminalViewer({ title }: SerialTerminalViewerProps) {
  const {
    autoScroll,
    connected,
    running,
    terminalLines,
    terminalActiveLine,
    terminalSettings,
    sendSettings,
    colorParserConfig,
    appendTerminalChunk,
  } = useSerialStore(
    useShallow((state) => ({
      autoScroll: state.autoScroll,
      connected: state.connected,
      running: state.running,
      terminalLines: state.terminalLines,
      terminalActiveLine: state.terminalActiveLine,
      terminalSettings: state.terminalSettings,
      sendSettings: state.sendSettings,
      colorParserConfig: state.colorParserConfig,
      appendTerminalChunk: state.appendTerminalChunk,
    }))
  );
  const addLog = useLogStore((state) => state.addLog);
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  // 行编辑模式状态
  const lineMode = terminalSettings.lineMode;
  const [editBuffer, setEditBuffer] = useState("");
  const [history, setHistory] = useState<string[]>(() => loadSendHistory());
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // 切换 lineMode 关闭时清空编辑缓冲，避免遗留状态
  useEffect(() => {
    if (!lineMode) {
      setEditBuffer("");
      setHistoryIndex(-1);
    }
  }, [lineMode]);

  // 只有末尾这 0~2 行会随按键和活动行变化，已提交的行原样取用。
  // 此前是把整个 terminalLines（可达数千行）map 成新对象，
  // 而 editBuffer / terminalActiveLine / focused 每次按键和每个到达字符都在变，
  // 于是敲一个字符就要重建整个终端缓冲。
  const tailLines = useMemo<TerminalDisplayLine[]>(() => {
    if (lineMode) {
      // 行编辑模式：显示设备已经回显的行 + 本地编辑缓冲（带 > 提示符）
      const promptLine = { id: -2, text: `> ${editBuffer}`, isActive: true };
      if (terminalActiveLine.length > 0) {
        return [{ id: -1, text: terminalActiveLine, isActive: false }, promptLine];
      }
      return [promptLine];
    }

    if (terminalActiveLine.length > 0 || focused) {
      return [{ id: -1, text: terminalActiveLine, isActive: true }];
    }

    return EMPTY_TAIL_LINES;
  }, [editBuffer, focused, lineMode, terminalActiveLine]);

  const displayLineCount = terminalLines.length + tailLines.length;

  // 按下标取行：虚拟列表只会问可见的那几十行，不需要把整表物化出来。
  const getDisplayLine = useCallback(
    (index: number): TerminalDisplayLine => {
      const committed = terminalLines[index];
      if (committed) return { id: committed.id, text: committed.text, isActive: false };
      return tailLines[index - terminalLines.length];
    },
    [tailLines, terminalLines]
  );

  const handleSave = useCallback(async () => {
    try {
      // 导出是用户主动触发的一次性操作，这里才需要把全部行物化出来
      const text = terminalLines
        .map((line) => line.text)
        .concat(tailLines.map((line) => line.text))
        .join("\n");
      const path = await exportTextAsTxt(text, "serial-terminal");
      if (path) addLog("success", `已保存当前终端 ${terminalLines.length + tailLines.length} 行到 ${path}`);
    } catch (error) {
      addLog("error", `保存当前终端失败: ${error}`);
    }
  }, [addLog, tailLines, terminalLines]);
  const { onContextMenu, contextMenu } = useSaveTxtContextMenu(handleSave);

  const rowVirtualizer = useVirtualizer({
    count: displayLineCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 15,
  });

  useEffect(() => {
    if (autoScroll && displayLineCount > 0) {
      rowVirtualizer.scrollToIndex(displayLineCount - 1, { align: "end" });
    }
  }, [autoScroll, displayLineCount, rowVirtualizer]);

  const focusTerminal = useCallback(() => {
    // 用户正在选择文本时不要夺焦，否则一松手选区就丢
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) {
      return;
    }
    captureRef.current?.focus();
  }, []);

  const copySelectionToClipboard = useCallback(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString() : "";
    if (!text) return false;
    return copyTextToClipboard(text, "终端选区", addLog);
  }, [addLog]);

  const emitLocalEcho = useCallback(
    (text: string) => {
      if (terminalSettings.localEcho && text.length > 0) {
        appendTerminalChunk(text);
      }
    },
    [appendTerminalChunk, terminalSettings.localEcho]
  );

  const sendTextChunk = useCallback(
    async (text: string) => {
      if (!connected || !text) {
        return;
      }

      try {
        setSending(true);
        await writeSerialText(text, sendSettings.encoding, "none");
        emitLocalEcho(text);
      } catch (error) {
        addLog("error", `终端发送失败: ${error}`);
      } finally {
        setSending(false);
      }
    },
    [addLog, connected, emitLocalEcho, sendSettings.encoding]
  );

  const sendRawChunk = useCallback(
    async (bytes: number[], localEchoText = "") => {
      if (!connected || bytes.length === 0) {
        return;
      }

      try {
        setSending(true);
        await writeSerialData(bytes);
        emitLocalEcho(localEchoText);
      } catch (error) {
        addLog("error", `终端发送失败: ${error}`);
      } finally {
        setSending(false);
      }
    },
    [addLog, connected, emitLocalEcho]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!connected || !running || sending) {
        return;
      }

      if (event.nativeEvent.isComposing) {
        return;
      }

      // Ctrl+Shift+C：始终复制选区
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") {
        if (copySelectionToClipboard()) {
          event.preventDefault();
        }
        return;
      }

      // Ctrl+Shift+V：触发粘贴（让浏览器派发 paste 事件给 textarea）
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
        // 浏览器会自动触发 onPaste，无需手动处理
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === "c") {
        // 有选区 → 复制；无选区且开启拦截 → SIGINT
        if (copySelectionToClipboard()) {
          event.preventDefault();
          return;
        }
        if (terminalSettings.interceptShortcuts) {
          event.preventDefault();
          void sendRawChunk([0x03]);
        }
        return;
      }

      if (terminalSettings.interceptShortcuts && event.ctrlKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void sendRawChunk([0x04]);
        return;
      }

      // 行编辑模式：本地累积，回车后整行发送，↑↓ 翻历史
      if (lineMode) {
        if (event.key === "Enter") {
          event.preventDefault();
          const text = editBuffer;
          const ending = getLineEndingText(sendSettings.lineEnding);
          setEditBuffer("");
          setHistoryIndex(-1);
          if (text.length === 0) {
            if (ending) {
              void sendRawChunk(Array.from(new TextEncoder().encode(ending)), ending);
            }
            return;
          }
          void sendTextChunk(text + ending);
          setHistory((prev) => pushSendHistory(prev, text));
          return;
        }

        if (event.key === "Backspace") {
          event.preventDefault();
          setEditBuffer((prev) => prev.slice(0, -1));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (history.length === 0) return;
          const next = Math.min(historyIndex + 1, history.length - 1);
          setHistoryIndex(next);
          setEditBuffer(history[next] ?? "");
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (historyIndex <= 0) {
            setHistoryIndex(-1);
            setEditBuffer("");
            return;
          }
          const next = historyIndex - 1;
          setHistoryIndex(next);
          setEditBuffer(history[next] ?? "");
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setEditBuffer("");
          setHistoryIndex(-1);
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          setEditBuffer((prev) => prev + "\t");
          return;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
          event.preventDefault();
          setEditBuffer((prev) => prev + event.key);
          setHistoryIndex(-1);
          return;
        }

        // 其余键 (左右箭头、Home、End 等) 在行编辑模式下不向设备直通
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void sendRawChunk(
          Array.from(new TextEncoder().encode(getLineEndingText(sendSettings.lineEnding))),
          getLineEndingText(sendSettings.lineEnding)
        );
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        void sendRawChunk([0x08], "\b");
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        void sendRawChunk([0x09], "\t");
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void sendRawChunk([0x1b]);
        return;
      }

      if (ARROW_KEY_BYTES[event.key]) {
        event.preventDefault();
        void sendRawChunk(ARROW_KEY_BYTES[event.key]);
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        event.preventDefault();
        void sendTextChunk(event.key);
      }
    },
    [
      connected,
      running,
      sending,
      terminalSettings.interceptShortcuts,
      sendSettings.lineEnding,
      sendRawChunk,
      sendTextChunk,
      copySelectionToClipboard,
      lineMode,
      editBuffer,
      history,
      historyIndex,
    ]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const text = event.clipboardData.getData("text");
      if (!text) return;
      event.preventDefault();
      // 行编辑模式：粘贴到编辑缓冲，不立即发送
      if (lineMode) {
        setEditBuffer((prev) => prev + text);
        setHistoryIndex(-1);
        return;
      }
      if (!connected || !running || sending) {
        return;
      }
      void sendTextChunk(text);
    },
    [connected, lineMode, running, sendTextChunk, sending]
  );

  const handleCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLTextAreaElement>) => {
      const text = event.data;
      // 行编辑模式：IME 输入累积到缓冲区
      if (lineMode) {
        if (text) {
          setEditBuffer((prev) => prev + text);
          setHistoryIndex(-1);
        }
        event.currentTarget.value = "";
        return;
      }
      if (!connected || !running || sending) {
        event.currentTarget.value = "";
        return;
      }

      if (text) {
        void sendTextChunk(text);
      }
      event.currentTarget.value = "";
    },
    [connected, lineMode, running, sendTextChunk, sending]
  );

  const handleInput = useCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    event.currentTarget.value = "";
  }, []);

  const emptyMessage = useMemo(() => {
    if (!connected) {
      return "请先连接串口，再进入终端会话。";
    }
    if (!running) {
      return "点击「开始」后，终端会话会在这里持续展开。";
    }
    return focused ? "终端已激活，可直接输入并回车发送。" : "单击终端区域后可直接输入命令。";
  }, [connected, focused, running]);

  return (
    <div className="relative flex h-full flex-col">
      {title && (
        <div className="border-b border-border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
          {title}
        </div>
      )}

      <div className="border-b border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {lineMode
          ? focused
            ? "行编辑模式：输入会先在本地累积，回车整行发送；↑↓ 翻历史，Esc 清空。复制：选中后 Ctrl+C 或 Ctrl+Shift+C。"
            : "行编辑模式已启用。点击终端区域以聚焦，输入会显示在 > 提示行后；回车后整行发送。"
          : focused
            ? "终端已获取焦点，直接输入即可发送。复制：选中后 Ctrl+C 或 Ctrl+Shift+C；Ctrl+C 在无选区时会发送 SIGINT。"
            : "点击终端区域以激活键盘输入；选中文本可直接 Ctrl+C 复制，粘贴会发送到串口。"}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-background p-2 font-mono text-xs leading-5"
        onClick={focusTerminal}
        onContextMenu={onContextMenu}
      >
        {displayLineCount === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const line = getDisplayLine(virtualRow.index);
              return (
                <div
                  key={`${line.id}-${virtualRow.key}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <SerialTerminalLineItem
                    text={line.text}
                    showCursor={line.isActive && focused}
                    colorParserConfig={colorParserConfig}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <textarea
        ref={captureRef}
        className="absolute -left-[9999px] top-0 h-0 w-0 opacity-0"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onInput={handleInput}
        onCompositionEnd={handleCompositionEnd}
      />
      {contextMenu}
    </div>
  );
}

interface SerialTerminalLineItemProps {
  text: string;
  showCursor: boolean;
  colorParserConfig: ColorParserConfig;
}

const SerialTerminalLineItem = React.memo(function SerialTerminalLineItem({
  text,
  showCursor,
  colorParserConfig,
}: SerialTerminalLineItemProps) {
  const textSegments = useMemo(() => parseColoredSegments(text, colorParserConfig), [colorParserConfig, text]);

  return (
    <div className="py-0.5 hover:bg-muted/50">
      <span className="whitespace-pre-wrap break-all">
        {textSegments.map((segment, index) => (
          <span key={index} className={segment.className} style={segment.styles}>
            {segment.text}
          </span>
        ))}
        {showCursor && <span className="ml-px inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle" />}
      </span>
    </div>
  );
});
