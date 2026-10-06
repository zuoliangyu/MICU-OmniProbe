import { useState, useCallback, useRef } from "react";
import { Send, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBluetoothStore } from "@/stores/bluetoothStore";
import { useLogStore } from "@/stores/logStore";
import { bleWrite, bleWriteString } from "@/lib/tauri";
import type { LineEnding } from "@/lib/serialTypes";
import { withResponseFlag } from "@/lib/bleTypes";
import { useShallow } from "zustand/react/shallow";

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

export function BleSendBar() {
  const { connected, writeCharUuid, sendSettings, addLines, setSendSettings } = useBluetoothStore(
    useShallow((state) => ({
      connected: state.connected,
      writeCharUuid: state.writeCharUuid,
      sendSettings: state.sendSettings,
      addLines: state.addLines,
      setSendSettings: state.setSendSettings,
    }))
  );
  const addLog = useLogStore((state) => state.addLog);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canSend = connected && !!writeCharUuid && !sending;

  const handleSend = useCallback(async () => {
    if (!writeCharUuid) {
      addLog("error", "请先选择一个可写特征值");
      return;
    }
    if (!inputText) return;

    try {
      setSending(true);
      const wr = withResponseFlag(sendSettings.withResponse);

      if (sendSettings.hexMode) {
        const cleaned = inputText.replace(/\s+/g, "");
        if (cleaned.length === 0) {
          addLog("warn", "HEX 输入为空");
          return;
        }
        if (cleaned.length % 2 !== 0 || /[^0-9a-fA-F]/.test(cleaned)) {
          addLog("error", "HEX 格式无效，应为偶数位 0-9/a-f");
          return;
        }
        const bytes: number[] = [];
        for (let i = 0; i < cleaned.length; i += 2) {
          bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
        }
        await bleWrite(writeCharUuid, bytes, wr);
        addLines([
          {
            timestamp: new Date(),
            text: `HEX(${bytes.length}B): ${inputText}`,
            level: "info",
            rawData: bytes,
            direction: "tx",
          },
        ]);
      } else {
        await bleWriteString(writeCharUuid, inputText, sendSettings.encoding, sendSettings.lineEnding, wr);
        const fullText = inputText + getLineEndingText(sendSettings.lineEnding);
        const bytes = Array.from(new TextEncoder().encode(fullText));
        addLines([
          {
            timestamp: new Date(),
            text: inputText,
            level: "info",
            rawData: bytes,
            direction: "tx",
          },
        ]);
      }

      setInputText("");
      inputRef.current?.focus();
    } catch (error) {
      addLog("error", `发送失败: ${error}`);
    } finally {
      setSending(false);
    }
  }, [addLines, addLog, inputText, sendSettings, writeCharUuid]);

  return (
    <div className="flex items-center gap-2 rounded-[22px] border border-border/60 bg-white/72 px-3 py-2 shadow-[0_8px_18px_rgba(73,93,142,0.05)]">
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 gap-1 rounded-full px-2 text-xs">
            <Settings2 className="h-3.5 w-3.5" />
            选项
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">HEX 模式</Label>
            <Switch checked={sendSettings.hexMode} onCheckedChange={(v) => setSendSettings({ hexMode: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">编码</Label>
            <Select
              value={sendSettings.encoding}
              onValueChange={(v) => setSendSettings({ encoding: v as "utf-8" | "ascii" | "gbk" })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="utf-8">UTF-8</SelectItem>
                <SelectItem value="ascii">ASCII</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">换行符</Label>
            <Select
              value={sendSettings.lineEnding}
              onValueChange={(v) => setSendSettings({ lineEnding: v as "none" | "lf" | "crlf" | "cr" })}
            >
              <SelectTrigger className="h-8 text-xs">
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
          <div className="space-y-1">
            <Label className="text-xs">写入响应</Label>
            <Select
              value={sendSettings.withResponse}
              onValueChange={(v) => setSendSettings({ withResponse: v as "auto" | "yes" | "no" })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="yes">需要响应 (Write)</SelectItem>
                <SelectItem value="no">无响应 (Write Without Response)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      <Input
        ref={inputRef}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        placeholder={
          !connected
            ? "未连接 BLE 设备"
            : !writeCharUuid
              ? "请先选择可写特征值"
              : sendSettings.hexMode
                ? "HEX：例如 48 65 6C 6C 6F"
                : "输入文本，回车发送"
        }
        className="h-8 flex-1 rounded-full text-xs"
        disabled={!canSend}
      />

      <Button
        size="sm"
        className="h-8 gap-1 rounded-full px-3 text-xs"
        onClick={() => void handleSend()}
        disabled={!canSend || !inputText}
      >
        <Send className="h-3.5 w-3.5" />
        发送
      </Button>
    </div>
  );
}
