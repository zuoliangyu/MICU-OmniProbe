import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Trash2, History, FileUp, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSerialStore } from "@/stores/serialStore";
import { useLogStore } from "@/stores/logStore";
import { loadSendHistory, pushSendHistory, saveSendHistory } from "@/lib/serialHistory";
import { useShallow } from "zustand/react/shallow";
import { recordSerialFileTx, sendSerialBytes, sendSerialPayload } from "@/lib/serialSend";
import { cancelSerialFileTransfer, sendSerialFile } from "@/lib/tauri";
import type { SerialFileTransferProgress, SerialFileTransferProtocol } from "@/lib/serialTypes";
import { formatBytes } from "@/lib/formatters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FILE_PROTOCOL_OPTIONS: { value: SerialFileTransferProtocol; label: string }[] = [
  { value: "raw", label: "原始字节（默认）" },
  { value: "xmodem", label: "XMODEM" },
  { value: "xmodem-1k", label: "XMODEM-1K" },
  { value: "ymodem", label: "YMODEM" },
  { value: "zmodem", label: "ZMODEM" },
];

export function SerialSendBar() {
  const { connected, activeSourceType, sendSettings, terminalSettings, textViewMode } = useSerialStore(
    useShallow((state) => ({
      connected: state.connected,
      activeSourceType: state.activeSourceType,
      sendSettings: state.sendSettings,
      terminalSettings: state.terminalSettings,
      textViewMode: state.textViewMode,
    }))
  );
  const addLog = useLogStore((state) => state.addLog);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSendHistory);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [fileProtocol, setFileProtocol] = useState<SerialFileTransferProtocol>("raw");
  const [rawChunkSize, setRawChunkSize] = useState(1024);
  const [rawIntervalMs, setRawIntervalMs] = useState(0);
  const [fileSending, setFileSending] = useState(false);
  const [fileProgress, setFileProgress] = useState<SerialFileTransferProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((activeSourceType === "udp" || activeSourceType === "simulation") && fileProtocol !== "raw") {
      setFileProtocol("raw");
    }
  }, [activeSourceType, fileProtocol]);

  useEffect(
    () => () => {
      void cancelSerialFileTransfer();
    },
    []
  );

  const moveHistory = useCallback(
    (direction: "older" | "newer") => {
      if (history.length === 0) {
        return;
      }

      if (direction === "older") {
        const nextIndex = historyIndex < history.length - 1 ? historyIndex + 1 : history.length - 1;
        setHistoryIndex(nextIndex);
        setInputText(history[nextIndex] ?? "");
        return;
      }

      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInputText("");
        return;
      }

      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setInputText(history[nextIndex] ?? "");
    },
    [history, historyIndex]
  );

  const sendRawBytes = useCallback(
    async (bytes: number[], label: string) => {
      if (!connected) {
        addLog("error", "串口未连接");
        return;
      }

      try {
        setSending(true);
        await sendSerialBytes(bytes, label);
      } catch (error) {
        addLog("error", `发送失败: ${error}`);
      } finally {
        setSending(false);
      }
    },
    [addLog, connected]
  );

  // Send text
  const handleSend = useCallback(async () => {
    if (!inputText.trim() && !sendSettings.hexMode) {
      return;
    }

    if (fileSending) return;
    if (!connected) {
      addLog("error", "串口未连接");
      return;
    }

    try {
      setSending(true);

      await sendSerialPayload(inputText);

      // Save to history
      setHistory((prev) => pushSendHistory(prev, inputText));

      setInputText("");
      setHistoryIndex(-1);
    } catch (error) {
      addLog("error", `发送失败: ${error}`);
    } finally {
      setSending(false);
    }
  }, [inputText, connected, fileSending, sendSettings, addLog]);

  const handleSendFile = useCallback(async () => {
    if (fileSending) {
      try {
        await cancelSerialFileTransfer();
        addLog("warn", "正在取消文件传输");
      } catch (error) {
        addLog("error", `取消文件传输失败: ${error}`);
      }
      return;
    }
    if (!connected) {
      addLog("error", "串口未连接");
      return;
    }

    let path: string | string[] | null;
    try {
      path = await open({ multiple: false, directory: false });
    } catch (error) {
      addLog("error", `打开文件失败: ${error}`);
      return;
    }
    if (typeof path !== "string") return;

    const name = path.split(/[\\/]/).pop() || path;
    setFileSending(true);
    setFileProgress({
      phase: fileProtocol === "raw" ? "sending" : "waiting",
      bytesSent: 0,
      totalBytes: 0,
      elapsedMs: 0,
    });
    try {
      const result = await sendSerialFile(
        {
          path,
          protocol: fileProtocol,
          rawChunkSize,
          rawIntervalMs,
          simulation: activeSourceType === "simulation",
        },
        setFileProgress
      );
      recordSerialFileTx(name, result.bytesSent, activeSourceType === "simulation");
      const seconds = Math.max(result.elapsedMs / 1000, 0.001);
      addLog(
        "success",
        `${name} 发送完成：${formatBytes(result.bytesSent)}，${formatBytes(result.bytesSent / seconds)}/s`
      );
    } catch (error) {
      const message = String(error);
      addLog(message.includes("取消") ? "warn" : "error", `文件发送失败: ${message}`);
    } finally {
      setFileSending(false);
      setFileProgress(null);
    }
  }, [activeSourceType, addLog, connected, fileProtocol, fileSending, rawChunkSize, rawIntervalMs]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (textViewMode === "terminal") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHistory("older");
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHistory("newer");
        return;
      }

      if (terminalSettings.interceptShortcuts && e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void sendRawBytes([0x03], "CTRL+C");
        return;
      }

      if (terminalSettings.interceptShortcuts && e.ctrlKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void sendRawBytes([0x04], "CTRL+D");
      }
    }
  };

  // Select history item
  const selectHistory = (text: string) => {
    setInputText(text);
    setHistoryIndex(history.findIndex((item) => item === text));
    inputRef.current?.focus();
  };

  // Clear history
  const clearHistory = () => {
    setHistory([]);
    saveSendHistory([]);
    setHistoryIndex(-1);
  };

  const fileSpeed =
    fileProgress && fileProgress.elapsedMs > 0
      ? formatBytes(fileProgress.bytesSent / (fileProgress.elapsedMs / 1000)) + "/s"
      : null;

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1 whitespace-nowrap" title="发送工具">
              <History className="h-3.5 w-3.5" />
              发送工具
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[320px] rounded-[24px] border-border/70 p-3">
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium text-foreground">发送工具</div>
              </div>

              <div className="rounded-[20px] border border-border/60 bg-muted/20">
                <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <History className="h-3.5 w-3.5" />
                    发送历史
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={clearHistory} title="清空历史">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto p-1.5">
                  {history.length > 0 ? (
                    history.map((item, index) => (
                      <button
                        key={index}
                        className="w-full truncate rounded-xl px-2.5 py-2 text-left text-xs font-mono hover:bg-accent"
                        onClick={() => selectHistory(item)}
                        title={item}
                      >
                        {item}
                      </button>
                    ))
                  ) : (
                    <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无历史记录</div>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-[20px] border border-border/60 bg-muted/20 p-2.5">
                <label htmlFor="serial-file-protocol" className="text-xs font-medium text-foreground">
                  文件发送协议
                </label>
                <Select
                  value={fileProtocol}
                  disabled={fileSending}
                  onValueChange={(value) => setFileProtocol(value as SerialFileTransferProtocol)}
                >
                  <SelectTrigger id="serial-file-protocol" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILE_PROTOCOL_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        disabled={
                          option.value !== "raw" && (activeSourceType === "udp" || activeSourceType === "simulation")
                        }
                        className="text-xs"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fileProtocol === "raw" && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      <span>分块字节数</span>
                      <Input
                        type="number"
                        min={64}
                        max={65536}
                        value={rawChunkSize}
                        disabled={fileSending}
                        onChange={(event) => setRawChunkSize(Number(event.target.value))}
                        className="h-8"
                      />
                    </label>
                    <label className="space-y-1 text-[11px] text-muted-foreground">
                      <span>分块间隔 (ms)</span>
                      <Input
                        type="number"
                        min={0}
                        max={60000}
                        value={rawIntervalMs}
                        disabled={fileSending}
                        onChange={(event) => setRawIntervalMs(Number(event.target.value))}
                        className="h-8"
                      />
                    </label>
                  </div>
                )}
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {fileProtocol === "raw"
                    ? "文件内容原样发送，不追加编码或换行。"
                    : "请先让设备进入对应协议的接收模式。协议传输期间普通接收显示会暂停。"}
                </p>
              </div>

              {textViewMode === "terminal" && (
                <div className="rounded-[20px] border border-border/60 bg-muted/20 p-2.5">
                  <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                    终端快捷发送
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void sendRawBytes([0x03], "CTRL+C")}>
                      Ctrl+C
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void sendRawBytes([0x04], "CTRL+D")}>
                      Ctrl+D
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void sendRawBytes([0x09], "TAB")}>
                      Tab
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void sendRawBytes([0x1b], "ESC")}>
                      Esc
                    </Button>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    终端视图下可用上下方向键切换本地发送历史，Ctrl+C / Ctrl+D 可直接发送控制字节。
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {textViewMode === "terminal" && (
          <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-secondary-foreground">
            {terminalSettings.localEcho ? "本地回显" : "设备回显"}
          </span>
        )}

        {fileSending && fileProgress && (
          <span className="max-w-56 truncate rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            {fileProgress.phase === "waiting"
              ? "等待接收端"
              : fileProgress.totalBytes > 0
                ? `${Math.round((fileProgress.bytesSent / fileProgress.totalBytes) * 100)}% · ${formatBytes(
                    fileProgress.bytesSent
                  )}/${formatBytes(fileProgress.totalBytes)}${fileSpeed ? ` · ${fileSpeed}` : ""}`
                : "准备发送"}
          </span>
        )}

        <div className="flex-1">
          <Input
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sendSettings.hexMode
                ? "输入十六进制 (如: 48 65 6C 6C 6F)"
                : textViewMode === "terminal"
                  ? "输入命令后回车发送，上下键可切换历史"
                  : "输入发送内容... Enter 发送"
            }
            disabled={!connected || fileSending}
            className="h-8 text-sm font-mono"
          />
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleSendFile()}
          disabled={sending || (!connected && !fileSending)}
          className="gap-1"
          title={fileSending ? "取消文件传输" : "发送文件"}
        >
          {fileSending ? <X className="h-3.5 w-3.5" /> : <FileUp className="h-3.5 w-3.5" />}
          {fileSending ? "取消" : "文件"}
        </Button>

        <Button
          size="sm"
          onClick={handleSend}
          disabled={!connected || sending || fileSending || (!inputText.trim() && !sendSettings.hexMode)}
          className="gap-1 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Send className="h-3.5 w-3.5" />
          发送
        </Button>
      </div>
    </div>
  );
}
