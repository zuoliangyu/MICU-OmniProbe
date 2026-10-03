import { useRef, useState } from "react";
import { History, Send, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRttStore } from "@/stores/rttStore";
import { useLogStore } from "@/stores/logStore";
import { writeRtt } from "@/lib/tauri";
import { parseHexBytes } from "@/lib/serialSend";
import { loadSendHistory, pushSendHistory, RTT_SEND_HISTORY_KEY, saveSendHistory } from "@/lib/serialHistory";
import type { Encoding, LineEnding } from "@/lib/serialTypes";
import { useShallow } from "zustand/react/shallow";

/** RTT 下行发送栏：把文本或 HEX 写入目标的下行通道（固件用 SEGGER_RTT_Read / GetKey 读取） */
export function RttSendBar() {
  const { isRunning, phase, downChannels, sendSettings, setSendSettings, addLines } = useRttStore(
    useShallow((state) => ({
      isRunning: state.isRunning,
      phase: state.phase,
      downChannels: state.downChannels,
      sendSettings: state.sendSettings,
      setSendSettings: state.setSendSettings,
      addLines: state.addLines,
    }))
  );
  const addLog = useLogStore((state) => state.addLog);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState(() => loadSendHistory(RTT_SEND_HISTORY_KEY));
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // 保存的通道在当前固件里不存在时退回第一个下行通道
  const channel = downChannels.some((ch) => ch.index === sendSettings.channel)
    ? sendSettings.channel
    : (downChannels[0]?.index ?? 0);
  const ready = isRunning && phase !== "recovering" && downChannels.length > 0;
  const placeholder = !isRunning
    ? "启动 RTT 后可向目标发送数据"
    : downChannels.length === 0
      ? "目标固件没有下行通道"
      : phase === "recovering"
        ? "正在重新附加，稍后可发送"
        : sendSettings.hexMode
          ? "输入十六进制 (如: 48 65 6C 6C 6F)，Enter 发送"
          : "输入发送内容，Enter 发送，上下键切换历史";

  const handleSend = async () => {
    if (!ready || sending || !inputText) return;
    try {
      setSending(true);
      let rawData: number[];
      if (sendSettings.hexMode) {
        rawData = parseHexBytes(inputText);
        if (rawData.length === 0) return;
        await writeRtt({ channel, data: rawData });
      } else {
        await writeRtt({
          channel,
          text: inputText,
          encoding: sendSettings.encoding,
          line_ending: sendSettings.lineEnding,
        });
        rawData = Array.from(new TextEncoder().encode(inputText));
      }
      addLines([
        {
          channel,
          timestamp: new Date(),
          text: sendSettings.hexMode ? `HEX(${rawData.length}B): ${inputText.trim()}` : inputText,
          level: "info",
          rawData,
          direction: "tx",
        },
      ]);
      setHistory((prev) => pushSendHistory(prev, inputText, RTT_SEND_HISTORY_KEY));
      setHistoryIndex(-1);
      setInputText("");
      inputRef.current?.focus();
    } catch (error) {
      addLog("error", `RTT 发送失败: ${error instanceof Error ? error.message : error}`);
    } finally {
      setSending(false);
    }
  };

  const moveHistory = (step: 1 | -1) => {
    if (history.length === 0) return;
    const next = Math.min(history.length - 1, Math.max(-1, historyIndex + step));
    setHistoryIndex(next);
    setInputText(next < 0 ? "" : history[next]);
  };

  return (
    <div className="flex items-center gap-2 rounded-[12px] border border-border/60 bg-muted/20 px-2 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1 whitespace-nowrap" title="发送选项与历史">
            <Settings2 className="h-3.5 w-3.5" />
            发送选项
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] space-y-3 rounded-[24px] border-border/70 p-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="rtt-send-hex" className="text-xs">
              HEX 模式
            </Label>
            <Switch
              id="rtt-send-hex"
              checked={sendSettings.hexMode}
              onCheckedChange={(hexMode) => setSendSettings({ hexMode })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="rtt-send-encoding" className="text-xs">
                编码
              </Label>
              <Select
                value={sendSettings.encoding}
                disabled={sendSettings.hexMode}
                onValueChange={(value) => setSendSettings({ encoding: value as Encoding })}
              >
                <SelectTrigger id="rtt-send-encoding" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utf-8">UTF-8</SelectItem>
                  <SelectItem value="ascii">ASCII</SelectItem>
                  <SelectItem value="gbk">GBK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rtt-send-line-ending" className="text-xs">
                换行符
              </Label>
              <Select
                value={sendSettings.lineEnding}
                disabled={sendSettings.hexMode}
                onValueChange={(value) => setSendSettings({ lineEnding: value as LineEnding })}
              >
                <SelectTrigger id="rtt-send-line-ending" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无</SelectItem>
                  <SelectItem value="lf">LF (\n)</SelectItem>
                  <SelectItem value="crlf">CRLF (\r\n)</SelectItem>
                  <SelectItem value="cr">CR (\r)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-[20px] border border-border/60 bg-muted/20">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <History className="h-3.5 w-3.5" />
                发送历史
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="清空历史"
                onClick={() => {
                  setHistory([]);
                  saveSendHistory([], RTT_SEND_HISTORY_KEY);
                  setHistoryIndex(-1);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto p-1.5">
              {history.length > 0 ? (
                history.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    className="w-full truncate rounded-xl px-2.5 py-2 text-left font-mono text-xs hover:bg-accent"
                    title={item}
                    onClick={() => {
                      setInputText(item);
                      setHistoryIndex(index);
                      inputRef.current?.focus();
                    }}
                  >
                    {item}
                  </button>
                ))
              ) : (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">暂无历史记录</div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {downChannels.length > 1 && (
        <Select value={String(channel)} onValueChange={(value) => setSendSettings({ channel: Number(value) })}>
          <SelectTrigger aria-label="RTT 下行通道" className="h-8 w-auto min-w-[104px] gap-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {downChannels.map((ch) => (
              <SelectItem key={ch.index} value={String(ch.index)} className="text-xs">
                下行 {ch.index}: {ch.name || "(未命名)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Input
        ref={inputRef}
        aria-label="RTT 发送内容"
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void handleSend();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveHistory(1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveHistory(-1);
          }
        }}
        placeholder={placeholder}
        disabled={!ready}
        className="h-8 flex-1 font-mono text-sm"
      />

      <Button
        size="sm"
        onClick={() => void handleSend()}
        disabled={!ready || sending || !inputText}
        className="gap-1 bg-blue-600 text-white hover:bg-blue-700"
      >
        <Send className="h-3.5 w-3.5" />
        发送
      </Button>
    </div>
  );
}
