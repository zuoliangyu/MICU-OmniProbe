import { Binary } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RxFramingMode, RxFramingSettings } from "@/lib/serialTypes";

interface RxFramingSettingsPanelProps {
  framing: RxFramingSettings;
  setFraming: (settings: Partial<RxFramingSettings>) => void;
  /** 附加说明，各来源的建议不同 */
  hint?: string;
}

/**
 * 接收分帧设置。串口、RTT 与蓝牙共用——分帧规则本身与数据来自哪条链路无关，
 * 三处各抄一份 60 行 UI 只会让以后加分帧模式时漏改。
 */
export function RxFramingSettingsPanel({ framing, setFraming, hint }: RxFramingSettingsPanelProps) {
  return (
    <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
      <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">接收分帧</div>
      <Select value={framing.mode} onValueChange={(value) => setFraming({ mode: value as RxFramingMode })}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">换行（自动 \n / \r\n）</SelectItem>
          <SelectItem value="lf">换行 LF（\n）</SelectItem>
          <SelectItem value="crlf">换行 CRLF（\r\n）</SelectItem>
          <SelectItem value="cr">换行 CR（\r）</SelectItem>
          <SelectItem value="timeout">空闲超时分帧</SelectItem>
          <SelectItem value="custom">自定义分隔符</SelectItem>
        </SelectContent>
      </Select>

      {framing.mode === "timeout" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">空闲</span>
          <Input
            type="number"
            min={5}
            value={framing.idleMs}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              setFraming({ idleMs: Number.isNaN(parsed) ? 0 : parsed });
            }}
            className="h-8 w-24 text-xs"
          />
          <span className="text-xs text-muted-foreground">ms 后断帧</span>
        </div>
      )}

      {framing.mode === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            value={framing.customDelimiter}
            onChange={(e) => setFraming({ customDelimiter: e.target.value })}
            placeholder={framing.customIsHex ? "如 0D 0A" : "分隔字符，如 ; 或 #"}
            className="h-8 flex-1 text-xs font-mono"
          />
          <Button
            size="sm"
            variant={framing.customIsHex ? "secondary" : "outline"}
            onClick={() => setFraming({ customIsHex: !framing.customIsHex })}
            className="gap-1"
            title="按十六进制解析分隔符"
          >
            <Binary className="h-3.5 w-3.5" />
            HEX
          </Button>
        </div>
      )}

      {hint && <div className="text-xs leading-4 text-muted-foreground">{hint}</div>}
    </div>
  );
}
