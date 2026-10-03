import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Crosshair, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RTT_MAX_LINES_OPTIONS, useRttStore } from "@/stores/rttStore";
import { useFlashStore } from "@/stores/flashStore";
import { formatHexAddress, parseHexAddress, RTT_SCAN_MODE_LABELS } from "@/lib/rttStart";
import type { RttScanMode } from "@/lib/types";
import { useShallow } from "zustand/react/shallow";

const SCAN_MODE_HINTS: Record<RttScanMode, string> = {
  auto: "扫描芯片的全部 RAM 区域。无需配置，RAM 较大时启动较慢。",
  elf: "从固件 ELF / AXF 的 _SEGGER_RTT 符号直接定位，启动最快；重新烧录后自动按新固件查找。",
  exact: "直接读取指定地址的控制块，地址可在 map 文件中查 _SEGGER_RTT。",
  range: "只扫描指定的地址范围，适合 RAM 很大或自动扫描读到无效区域的芯片。",
};

const ELF_PATTERN = /\.(elf|axf|out)$/i;

interface RttStartSettingsPanelProps {
  /** 当前连接目标的核心数；大于 1 时显示核心选择 */
  coreCount: number;
  /** 运行或启动中时设置只读，修改在下次启动生效 */
  disabled: boolean;
}

/** 十六进制输入框：编辑时保留原始文本，失焦或回车时校验并提交 */
function HexField({
  id,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  value: number;
  onCommit: (value: number) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseHexAddress(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const parsed = parseHexAddress(draft);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };
  return (
    <Input
      id={id}
      value={draft ?? formatHexAddress(value)}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={`h-8 font-mono text-xs ${invalid ? "border-red-500 focus-visible:ring-red-500" : ""}`}
    />
  );
}

export function RttStartSettingsPanel({ coreCount, disabled }: RttStartSettingsPanelProps) {
  const { settings, setSettings, maxLines, setMaxLines } = useRttStore(
    useShallow((state) => ({
      settings: state.startSettings,
      setSettings: state.setStartSettings,
      maxLines: state.maxLines,
      setMaxLines: state.setMaxLines,
    }))
  );
  const firmwarePath = useFlashStore((state) => state.firmwarePath);
  const flashElf = firmwarePath && ELF_PATTERN.test(firmwarePath) ? firmwarePath : null;

  const pickElf = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "ELF 固件", extensions: ["elf", "axf", "out"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (typeof selected === "string") setSettings({ elfPath: selected });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1" title="控制块查找方式、轮询间隔等启动设置">
          <Crosshair className="h-3.5 w-3.5" />
          {RTT_SCAN_MODE_LABELS[settings.scanMode]}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="max-h-[calc(100vh-7rem)] w-[360px] space-y-3 overflow-y-auto overscroll-contain rounded-[24px] border-border/70 p-3"
      >
        <div>
          <div className="text-sm font-medium text-foreground">RTT 启动设置</div>
          <div className="text-xs text-muted-foreground">
            {disabled ? "RTT 运行中，修改在下次启动时生效。" : "设置会自动保存。"}
          </div>
        </div>

        <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
          <div className="space-y-1">
            <Label htmlFor="rtt-scan-mode" className="text-xs">
              扫描模式
            </Label>
            <Select
              value={settings.scanMode}
              disabled={disabled}
              onValueChange={(value) => setSettings({ scanMode: value as RttScanMode })}
            >
              <SelectTrigger id="rtt-scan-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RTT_SCAN_MODE_LABELS) as RttScanMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode} className="text-xs">
                    {RTT_SCAN_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">{SCAN_MODE_HINTS[settings.scanMode]}</p>
          </div>

          {settings.scanMode === "elf" && (
            <div className="space-y-1.5">
              <Label className="text-xs">固件 ELF 文件</Label>
              <div
                className="truncate rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-xs"
                title={settings.elfPath || undefined}
              >
                {settings.elfPath || <span className="font-sans text-muted-foreground">尚未选择</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={disabled}
                  onClick={() => void pickElf()}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  选择文件
                </Button>
                {flashElf && flashElf !== settings.elfPath && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => setSettings({ elfPath: flashElf })}
                  >
                    使用烧录固件
                  </Button>
                )}
              </div>
            </div>
          )}

          {(settings.scanMode === "exact" || settings.scanMode === "range") && (
            <div className="grid grid-cols-2 gap-2">
              <div className={`space-y-1 ${settings.scanMode === "exact" ? "col-span-2" : ""}`}>
                <Label htmlFor="rtt-scan-address" className="text-xs">
                  {settings.scanMode === "exact" ? "控制块地址" : "起始地址"}
                </Label>
                <HexField
                  id="rtt-scan-address"
                  value={settings.scanAddress}
                  disabled={disabled}
                  onCommit={(scanAddress) => setSettings({ scanAddress })}
                />
              </div>
              {settings.scanMode === "range" && (
                <div className="space-y-1">
                  <Label htmlFor="rtt-range-size" className="text-xs">
                    范围大小 (字节)
                  </Label>
                  <HexField
                    id="rtt-range-size"
                    value={settings.rangeSize}
                    disabled={disabled}
                    onCommit={(rangeSize) => setSettings({ rangeSize: Math.max(1, rangeSize) })}
                  />
                </div>
              )}
            </div>
          )}

          {coreCount > 1 && (
            <div className="space-y-1">
              <Label htmlFor="rtt-core" className="text-xs">
                核心
              </Label>
              <Select
                value={String(Math.min(settings.coreIndex, coreCount - 1))}
                disabled={disabled}
                onValueChange={(value) => setSettings({ coreIndex: Number(value) })}
              >
                <SelectTrigger id="rtt-core" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: coreCount }, (_, index) => (
                    <SelectItem key={index} value={String(index)} className="text-xs">
                      核心 {index}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="rtt-poll-interval" className="text-xs">
                轮询间隔 (ms)
              </Label>
              <Input
                id="rtt-poll-interval"
                type="number"
                min={1}
                max={1000}
                value={settings.pollInterval}
                disabled={disabled}
                onChange={(event) =>
                  setSettings({
                    pollInterval: Math.min(1000, Math.max(1, Math.round(Number(event.target.value)) || 1)),
                  })
                }
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rtt-recover-timeout" className="text-xs">
                失联等待 (秒)
              </Label>
              <Input
                id="rtt-recover-timeout"
                type="number"
                min={1}
                max={600}
                value={Math.round(settings.recoverTimeoutMs / 1000)}
                disabled={disabled}
                onChange={(event) =>
                  setSettings({
                    recoverTimeoutMs: Math.min(600, Math.max(1, Math.round(Number(event.target.value)) || 1)) * 1000,
                  })
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            目标复位、重新烧录或掉电后，在等待时间内持续尝试重新附加，超时才停止。
          </p>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="rtt-halt-on-read" className="text-xs">
                读取时暂停目标
              </Label>
              <p className="text-xs leading-5 text-muted-foreground">会打断目标实时运行，仅在数据错乱时开启。</p>
            </div>
            <Switch
              id="rtt-halt-on-read"
              checked={settings.haltOnRead}
              disabled={disabled}
              onCheckedChange={(haltOnRead) => setSettings({ haltOnRead })}
            />
          </div>
        </div>

        <div className="space-y-1 rounded-[16px] border border-border/60 bg-muted/20 p-3">
          <Label htmlFor="rtt-max-lines" className="text-xs">
            文本区保留行数
          </Label>
          <Select value={String(maxLines)} onValueChange={(value) => setMaxLines(Number(value))}>
            <SelectTrigger id="rtt-max-lines" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RTT_MAX_LINES_OPTIONS.map((count) => (
                <SelectItem key={count} value={String(count)} className="text-xs">
                  {count.toLocaleString()} 行
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
