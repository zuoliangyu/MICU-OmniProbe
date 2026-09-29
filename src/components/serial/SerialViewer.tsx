import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSerialStore } from "@/stores/serialStore";
import { useLogStore } from "@/stores/logStore";
import { cn } from "@/lib/utils";
import type { ViewerLine } from "@/lib/serialTypes";
import { LOG_LEVEL_COLORS, parseColoredSegments } from "@/lib/coloredSegments";
import { useViewerSelection, formatSerialLineForCopy, formatDataAsHex, copyTextToClipboard } from "@/lib/viewerCopy";
import { exportTextAsTxt } from "@/lib/exporters";
import { useShallow } from "zustand/react/shallow";
import { formatTimestamp } from "@/lib/formatters";
import { lineMatchesQuery } from "@/lib/lineSearch";

interface SerialViewerProps {
  direction?: "rx" | "tx";
  title?: string;
  data?: SerialViewerData;
}

export interface SerialViewerData {
  autoScroll: boolean;
  showTimestamp: boolean;
  timestampFormat: string;
  showDirectionPrefix: boolean;
  running: boolean;
  displayMode: "text" | "hex";
  connected: boolean;
  lines: ViewerLine[];
  searchQuery: string;
}

type CopyMode = "plain" | "with-timestamp" | "full";

// CopyMode → 是否带时间戳 / 方向前缀
const COPY_MODE_OPTS: Record<CopyMode, { ts: boolean; dir: boolean; label: string }> = {
  plain: { ts: false, dir: false, label: "纯文本" },
  "with-timestamp": { ts: true, dir: false, label: "含时间戳" },
  full: { ts: true, dir: true, label: "完整行" },
};

const formatLineForCopy = (line: ViewerLine, mode: CopyMode, timestampFormat: string): string => {
  const o = COPY_MODE_OPTS[mode];
  return formatSerialLineForCopy(line, o.ts, o.dir, timestampFormat);
};

export function SerialViewer({ direction, title, data }: SerialViewerProps) {
  // 外部传入 data（如控制面板的 RTT 来源）时不订阅串口 store，避免被另一条数据流带着重渲染
  const storeData = useSerialStore(
    useShallow((state) =>
      data
        ? null
        : {
            autoScroll: state.autoScroll,
            showTimestamp: state.showTimestamp,
            timestampFormat: state.timestampFormat,
            showDirectionPrefix: state.showDirectionPrefix,
            running: state.running,
            displayMode: state.displayMode,
            connected: state.connected,
            lines: state.lines,
            searchQuery: state.searchQuery,
          }
    )
  );
  const {
    autoScroll,
    showTimestamp,
    timestampFormat,
    showDirectionPrefix,
    running,
    displayMode,
    connected,
    lines,
    searchQuery,
  } = (data ?? storeData)!;
  const addLog = useLogStore((state) => state.addLog);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);

  // Filter lines - cached with useMemo to avoid infinite loops
  const filteredLines = useMemo(() => {
    let filtered = lines;

    // Filter by direction if specified
    if (direction) {
      filtered = filtered.filter((line) => (line.direction ?? "rx") === direction);
    }

    // Filter by search query（行文本的小写形式按行对象缓存，避免每批数据重算整个缓冲区）
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((line) => lineMatchesQuery(line, query));
    }

    return filtered;
  }, [lines, direction, searchQuery]);

  const { scrollRef, getSelectedRange, isSelectAll, highlight, clearSelection, selectLine } =
    useViewerSelection(filteredLines);

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 15,
  });

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" });
    }
  }, [filteredLines.length, autoScroll, rowVirtualizer]);

  const writeToClipboard = useCallback(
    (text: string, label: string) => copyTextToClipboard(text, label, addLog),
    [addLog]
  );

  const copySelection = useCallback(
    (mode: CopyMode) => {
      const range = getSelectedRange();
      const sel = window.getSelection();
      const rawText = sel ? sel.toString() : "";

      // 纯文本 + 单行选区 + 非全选：保留精确的字符级选区（行内半句）
      if (mode === "plain" && rawText && !isSelectAll() && range && range.start === range.end) {
        const copied = writeToClipboard(rawText, "纯文本");
        if (copied) clearSelection();
        return copied;
      }

      // 其余一律按行号区间从数据数组重建，绕开虚拟滚动的 DOM 截断
      if (!range) {
        if (mode === "plain" && rawText) {
          const copied = writeToClipboard(rawText, "纯文本");
          if (copied) clearSelection();
          return copied;
        }
        return false;
      }
      const slice = filteredLines.slice(range.start, range.end + 1);
      if (slice.length === 0) return false;
      const text = slice
        .map((line) =>
          formatLineForCopy(
            displayMode === "hex" ? { ...line, text: formatDataAsHex(line.rawData, line.text) } : line,
            mode,
            timestampFormat
          )
        )
        .join("\n");
      const copied = writeToClipboard(text, COPY_MODE_OPTS[mode].label);
      if (copied) clearSelection();
      return copied;
    },
    [clearSelection, displayMode, filteredLines, writeToClipboard, getSelectedRange, isSelectAll, timestampFormat]
  );

  // Ctrl+C 纯文本 / Ctrl+Shift+C 完整行（均按行号区间重建，跨滚动不丢）
  useEffect(() => {
    const isInside = () => {
      const c = scrollRef.current;
      if (!c) return false;
      if (isSelectAll() || c.matches(":hover")) return true;
      const sel = window.getSelection();
      return !!(sel && sel.anchorNode && c.contains(sel.anchorNode));
    };
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.key.toLowerCase() === "c")) return;
      if (event.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (!isInside()) return;
      if (copySelection(event.shiftKey ? "full" : "plain")) {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [copySelection, scrollRef, isSelectAll]);

  const saveAll = useCallback(async () => {
    try {
      const content = filteredLines
        .map((line) =>
          formatSerialLineForCopy(
            { ...line, text: displayMode === "hex" ? formatDataAsHex(line.rawData, line.text) : line.text },
            showTimestamp,
            showDirectionPrefix,
            timestampFormat
          )
        )
        .join("\n");
      const path = await exportTextAsTxt(content, "serial");
      if (path) addLog("success", `已保存当前窗口 ${filteredLines.length} 行到 ${path}`);
    } catch (error) {
      addLog("error", `保存当前窗口失败: ${error}`);
    }
  }, [addLog, displayMode, filteredLines, showDirectionPrefix, showTimestamp, timestampFormat]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const sel = window.getSelection();
      const clickedLine = (event.target as HTMLElement).closest<HTMLElement>("[data-line-index]");
      const clickedIndex = clickedLine ? Number(clickedLine.dataset.lineIndex) : null;
      const range = getSelectedRange();
      event.preventDefault();
      scrollRef.current?.focus({ preventScroll: true });
      if (clickedIndex !== null && (!range || clickedIndex < range.start || clickedIndex > range.end)) {
        selectLine(clickedIndex);
      }
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        canCopy: clickedIndex !== null || range !== null || (!!sel && !sel.isCollapsed && sel.toString().length > 0),
      });
    },
    [getSelectedRange, scrollRef, selectLine]
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 点击外部 / 滚动 / Esc 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = () => closeContextMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu, closeContextMenu]);

  // Empty state message based on direction
  const getEmptyMessage = () => {
    if (!connected) {
      return "请在右侧配置检查器连接串口";
    }
    if (!running) {
      return "点击「开始」接收串口数据";
    }
    if (direction === "rx") {
      return "等待接收数据...";
    }
    if (direction === "tx") {
      return "暂无发送数据";
    }
    return "等待数据...";
  };

  // Empty state
  if (filteredLines.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {title && (
          <div className="px-2 py-1 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
            {title}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">{getEmptyMessage()}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {title && (
        <div className="px-2 py-1 border-b border-border bg-muted/50 text-xs font-medium text-muted-foreground">
          {title} ({filteredLines.length})
        </div>
      )}
      <div
        ref={scrollRef}
        tabIndex={0}
        className={cn(
          "flex-1 overflow-y-auto font-mono text-xs leading-5 p-2 bg-background outline-none",
          highlight && "select-none" // 跨行/全选时关掉原生选区，只留行级高亮，避免两套高亮打架
        )}
        onContextMenu={handleContextMenu}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const line = filteredLines[virtualRow.index];
            const selected = !!highlight && virtualRow.index >= highlight.start && virtualRow.index <= highlight.end;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-line-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ViewerLineItem
                  line={line}
                  showTimestamp={showTimestamp}
                  timestampFormat={timestampFormat}
                  showDirectionPrefix={showDirectionPrefix}
                  displayMode={displayMode}
                  selected={selected}
                />
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && (
        <CopyContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canCopy={contextMenu.canCopy}
          onPick={(mode) => {
            copySelection(mode);
            closeContextMenu();
          }}
          onSave={() => {
            closeContextMenu();
            void saveAll();
          }}
        />
      )}
    </div>
  );
}

interface CopyContextMenuProps {
  x: number;
  y: number;
  canCopy: boolean;
  onPick: (mode: CopyMode) => void;
  onSave: () => void;
}

function CopyContextMenu({ x, y, canCopy, onPick, onSave }: CopyContextMenuProps) {
  const items: Array<{ mode: CopyMode; label: string; hint?: string }> = [
    { mode: "plain", label: "复制（纯文本）", hint: "Ctrl+C" },
    { mode: "with-timestamp", label: "复制（含时间戳）" },
    { mode: "full", label: "复制（含时间戳 + RX/TX）", hint: "Ctrl+Shift+C" },
  ];
  return createPortal(
    <div
      role="menu"
      className="fixed z-50 min-w-[220px] rounded-md border border-border bg-background py-1 text-sm text-foreground shadow-xl"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 236)),
        top: Math.max(8, Math.min(y, window.innerHeight - 156)),
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((item) => (
        <button
          key={item.mode}
          type="button"
          role="menuitem"
          disabled={!canCopy}
          className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-50"
          onClick={() => onPick(item.mode)}
        >
          <span>{item.label}</span>
          {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
        </button>
      ))}
      <div className="my-1 border-t border-border" />
      <button type="button" role="menuitem" className="w-full px-3 py-1.5 text-left hover:bg-muted" onClick={onSave}>
        保存当前窗口全部内容为 TXT
      </button>
    </div>,
    document.body
  );
}

interface ViewerLineItemProps {
  line: ViewerLine;
  showTimestamp: boolean;
  timestampFormat: string;
  showDirectionPrefix: boolean;
  displayMode: "text" | "hex";
  selected: boolean;
}

const ViewerLineItem = React.memo(function ViewerLineItem({
  line,
  showTimestamp,
  timestampFormat,
  showDirectionPrefix,
  displayMode,
  selected,
}: ViewerLineItemProps) {
  const colorParserConfig = useSerialStore((state) => state.colorParserConfig);

  const textSegments = useMemo(
    () => parseColoredSegments(line.text, colorParserConfig),
    [line.text, colorParserConfig]
  );

  return (
    <div
      className={cn(
        "flex items-baseline gap-2 py-0.5 hover:bg-muted/50",
        LOG_LEVEL_COLORS[line.level],
        selected && "bg-primary/20"
      )}
    >
      {showTimestamp && (
        <span className="text-muted-foreground shrink-0 select-none font-mono">
          [{formatTimestamp(line.timestamp.getTime(), timestampFormat)}]
        </span>
      )}
      {showDirectionPrefix && (
        <span
          className={cn(
            "shrink-0 select-none font-mono text-xs",
            line.direction === "tx" ? "text-sky-600" : "text-emerald-600"
          )}
        >
          {line.direction === "tx" ? "【TX】" : "【RX】"}
        </span>
      )}
      {displayMode === "hex" ? (
        <span className="whitespace-pre-wrap break-all font-mono">{formatDataAsHex(line.rawData, line.text)}</span>
      ) : (
        <span className="whitespace-pre-wrap break-all">
          {textSegments.map((segment, index) => (
            <span key={index} className={segment.className} style={segment.styles}>
              {segment.text}
            </span>
          ))}
        </span>
      )}
    </div>
  );
});
