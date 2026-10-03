import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PRESET_COLORS, type CanBusConfig, type CanSignalSource, type Channel } from "@/lib/chartTypes";
import { parseDbc } from "@/lib/parseDbc";

interface CanSignalEditorProps {
  canBus: CanBusConfig;
  channels: Channel[];
  onCanBusChange: (config: CanBusConfig) => void;
  onChannelsChange: (channels: Channel[]) => void;
}

const DEFAULT_SOURCE: CanSignalSource = {
  frameId: 0x100,
  extended: false,
  startBit: 0,
  bitLength: 8,
  byteOrder: "little",
  signed: false,
  factor: 1,
  offset: 0,
};

export function CanSignalEditor({ canBus, channels, onCanBusChange, onChannelsChange }: CanSignalEditorProps) {
  const [importStatus, setImportStatus] = useState("");
  const updateChannel = (index: number, patch: Partial<Channel>) => {
    onChannelsChange(channels.map((channel, current) => (current === index ? { ...channel, ...patch } : channel)));
  };

  const updateSource = (index: number, patch: Partial<CanSignalSource>) => {
    const channel = channels[index];
    updateChannel(index, { can: { ...(channel.can ?? DEFAULT_SOURCE), ...patch } });
  };

  const addSignal = () => {
    const used = new Set(channels.map(({ key }) => key));
    let number = channels.length + 1;
    while (used.has(`can${number}`)) number += 1;
    const key = `can${number}`;
    onChannelsChange([
      ...channels,
      {
        key,
        name: `CAN 信号 ${number}`,
        color: PRESET_COLORS[channels.length % PRESET_COLORS.length],
        visible: true,
        role: "y",
        can: { ...DEFAULT_SOURCE, startBit: Math.min(channels.length * 8, 63) },
      },
    ]);
  };

  const importDbc = async () => {
    const path = await open({ multiple: false, filters: [{ name: "CAN 数据库", extensions: ["dbc"] }] });
    if (typeof path !== "string") return;
    try {
      const result = parseDbc(await invoke<string>("read_text_file", { path }));
      onChannelsChange(result.channels);
      setImportStatus(
        `已导入 ${result.messageCount} 个消息、${result.channels.length} 个信号` +
          (result.skippedMultiplexedSignals ? `，跳过 ${result.skippedMultiplexedSignals} 个多路复用信号` : "")
      );
    } catch (error) {
      setImportStatus(`DBC 导入失败：${error}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 11rem), 1fr))" }}>
        <div className="space-y-2">
          <Label htmlFor="can-bitrate">CAN 波特率 (bit/s)</Label>
          <Input
            id="can-bitrate"
            type="number"
            min={1_000}
            max={10_000_000}
            step={1_000}
            value={canBus.bitrate}
            onChange={(event) => onCanBusChange({ ...canBus, bitrate: Number(event.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="can-data-bitrate">FD 数据波特率 (bit/s)</Label>
          <Input
            id="can-data-bitrate"
            type="number"
            min={1_000}
            max={20_000_000}
            step={1_000}
            value={canBus.dataBitrate}
            onChange={(event) => onCanBusChange({ ...canBus, dataBitrate: Number(event.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>负载统计窗口</Label>
          <Select
            value={String(canBus.loadWindowMs)}
            onValueChange={(value) => onCanBusChange({ ...canBus, loadWindowMs: Number(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="100">100 ms</SelectItem>
              <SelectItem value="500">500 ms</SelectItem>
              <SelectItem value="1000">1 s</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>负载告警</Label>
          <Select
            value={String(canBus.alarmThreshold)}
            onValueChange={(value) => onCanBusChange({ ...canBus, alarmThreshold: Number(value) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.6">60%</SelectItem>
              <SelectItem value="0.7">70%</SelectItem>
              <SelectItem value="0.8">80%</SelectItem>
              <SelectItem value="0.9">90%</SelectItem>
              <SelectItem value="1">100%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 rounded-[8px] border border-border/60 p-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 leading-5">连接后自动初始化适配器</span>
          <Switch
            className="shrink-0"
            checked={canBus.autoInitialize}
            onCheckedChange={(autoInitialize) => onCanBusChange({ ...canBus, autoInitialize })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 leading-5">启用适配器时间戳</span>
          <Switch
            className="shrink-0"
            checked={canBus.timestamps}
            onCheckedChange={(timestamps) => onCanBusChange({ ...canBus, timestamps })}
          />
        </label>
        <div className="space-y-1">
          <Label htmlFor="can-init-commands">自定义初始化命令（每行一条）</Label>
          <textarea
            id="can-init-commands"
            value={canBus.initCommands}
            onChange={(event) => onCanBusChange({ ...canBus, initCommands: event.target.value })}
            placeholder={"留空使用 C / S0-S8 / Z / O\nCAN FD 适配器可在此填写厂商命令"}
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium">Payload 信号</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Intel 使用 LSB0；Motorola 使用 DBC sawtooth 位编号。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant="outline" className="w-full gap-1" onClick={importDbc}>
            <FileUp className="h-3.5 w-3.5" />
            导入 DBC
          </Button>
          <Button type="button" size="sm" variant="outline" className="w-full gap-1" onClick={addSignal}>
            <Plus className="h-3.5 w-3.5" />
            添加信号
          </Button>
        </div>
      </div>
      {importStatus && <div className="text-xs text-muted-foreground">{importStatus}</div>}

      {channels.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
          未配置信号时仍会解析 CAN 帧并统计总线负载。
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((channel, index) => {
            const source = channel.can ?? DEFAULT_SOURCE;
            return (
              <div key={`${channel.key}-${index}`} className="space-y-3 rounded-[8px] border border-border/60 p-3">
                <div className="grid gap-2">
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8rem), 1fr))" }}
                  >
                    <Input
                      value={channel.key}
                      onChange={(event) => updateChannel(index, { key: event.target.value })}
                      placeholder="channel_key"
                      className="h-8 min-w-0 font-mono"
                    />
                    <Input
                      value={channel.name}
                      onChange={(event) => updateChannel(index, { name: event.target.value })}
                      placeholder="显示名称"
                      className="h-8 min-w-0"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={channel.unit ?? ""}
                      onChange={(event) => updateChannel(index, { unit: event.target.value || undefined })}
                      placeholder="单位"
                      className="h-8 min-w-0 flex-1"
                    />
                    <input
                      type="color"
                      value={channel.color}
                      onChange={(event) => updateChannel(index, { color: event.target.value })}
                      className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                      aria-label={`${channel.name} 颜色`}
                    />
                    <Switch
                      className="shrink-0"
                      checked={channel.visible}
                      onCheckedChange={(visible) => updateChannel(index, { visible })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => onChannelsChange(channels.filter((_, current) => current !== index))}
                      aria-label={`删除 ${channel.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr))" }}
                >
                  <Field label="CAN ID (HEX)">
                    <Input
                      value={`0x${source.frameId.toString(16).toUpperCase()}`}
                      onChange={(event) => {
                        const text = event.target.value.replace(/^0x/i, "");
                        if (/^[0-9a-f]*$/i.test(text)) {
                          updateSource(index, { frameId: Number.parseInt(text || "0", 16) });
                        }
                      }}
                      className="h-8 font-mono"
                    />
                  </Field>
                  <Field label="帧类型">
                    <Select
                      value={source.extended ? "extended" : "standard"}
                      onValueChange={(value) => updateSource(index, { extended: value === "extended" })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">标准帧 11-bit</SelectItem>
                        <SelectItem value="extended">扩展帧 29-bit</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="总线类型">
                    <Select
                      value={source.fd === undefined ? "any" : source.fd ? "fd" : "classic"}
                      onValueChange={(value) =>
                        updateSource(index, { fd: value === "any" ? undefined : value === "fd" })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">经典 / FD</SelectItem>
                        <SelectItem value="classic">经典 CAN</SelectItem>
                        <SelectItem value="fd">CAN FD</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <NumberField
                    label="起始位"
                    value={source.startBit}
                    min={0}
                    max={511}
                    onChange={(startBit) => updateSource(index, { startBit })}
                  />
                  <NumberField
                    label="位宽"
                    value={source.bitLength}
                    min={1}
                    max={64}
                    onChange={(bitLength) => updateSource(index, { bitLength })}
                  />
                  <Field label="字节序">
                    <Select
                      value={source.byteOrder}
                      onValueChange={(byteOrder) => updateSource(index, { byteOrder: byteOrder as "little" | "big" })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="little">Intel / Little</SelectItem>
                        <SelectItem value="big">Motorola / Big</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="数值类型">
                    <Select
                      value={source.signed ? "signed" : "unsigned"}
                      onValueChange={(value) => updateSource(index, { signed: value === "signed" })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unsigned">无符号</SelectItem>
                        <SelectItem value="signed">有符号</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <NumberField
                    label="比例"
                    value={source.factor}
                    onChange={(factor) => updateSource(index, { factor })}
                  />
                  <NumberField
                    label="偏移"
                    value={source.offset}
                    onChange={(offset) => updateSource(index, { offset })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step="any"
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8"
      />
    </Field>
  );
}
