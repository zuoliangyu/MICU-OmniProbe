import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SERIAL_CONTROL_WIDGET_GROUPS,
  type SerialControlWidget,
  type SerialControlWidgetType,
} from "@/lib/serialControlPanel";
import { cn } from "@/lib/utils";
import { SerialViewer, type SerialViewerData } from "./SerialViewer";

export type SerialDisplayWidget = Extract<
  SerialControlWidget,
  { type: "value" | "indicator" | "gauge" | "serial-log" }
>;

const DISPLAY_WIDGET_TYPES = new Set<SerialControlWidgetType>(
  SERIAL_CONTROL_WIDGET_GROUPS.find(({ title }) => title === "数据显示")?.items.map(({ type }) => type) ?? []
);

export function isSerialDisplayWidget(widget: SerialControlWidget): widget is SerialDisplayWidget {
  return DISPLAY_WIDGET_TYPES.has(widget.type);
}

export function SerialDisplayWidgetEditor({
  widget,
  onChange,
}: {
  widget: SerialDisplayWidget;
  onChange: (widget: SerialDisplayWidget) => void;
}) {
  return (
    <>
      {(widget.type === "gauge" || widget.type === "value" || widget.type === "indicator") && (
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${widget.id}-channel`}>接收通道 key</Label>
            <Input
              id={`${widget.id}-channel`}
              list="serial-control-channels"
              value={widget.channel}
              onChange={(event) => onChange({ ...widget, channel: event.target.value })}
              placeholder="例如 temp"
            />
          </div>
          {(widget.type === "gauge" || widget.type === "value") && (
            <div className="space-y-1.5">
              <Label htmlFor={`${widget.id}-unit`}>单位</Label>
              <Input
                id={`${widget.id}-unit`}
                value={widget.unit}
                onChange={(event) => onChange({ ...widget, unit: event.target.value })}
                placeholder="例如 ℃"
              />
            </div>
          )}
        </div>
      )}

      {widget.type === "indicator" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${widget.id}-threshold`}>触发阈值（大于等于时点亮）</Label>
          <Input
            id={`${widget.id}-threshold`}
            type="number"
            value={widget.threshold}
            onChange={(event) => onChange({ ...widget, threshold: Number(event.target.value) })}
          />
        </div>
      )}

      {widget.type === "serial-log" && (
        <div className="space-y-1.5">
          <Label>日志方向</Label>
          <Select
            value={widget.direction}
            onValueChange={(direction: "all" | "rx" | "tx") => onChange({ ...widget, direction })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="rx">仅接收 RX</SelectItem>
              <SelectItem value="tx">仅发送 TX</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {widget.type === "gauge" && (
        <div className="grid gap-3">
          {(["min", "max"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`${widget.id}-${key}`}>{key === "min" ? "最小值" : "最大值"}</Label>
              <Input
                id={`${widget.id}-${key}`}
                type="number"
                value={widget[key]}
                onChange={(event) => onChange({ ...widget, [key]: Number(event.target.value) })}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>方向</Label>
            <Select
              value={widget.direction}
              onValueChange={(direction: "horizontal" | "vertical") => onChange({ ...widget, direction })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="horizontal">横向</SelectItem>
                <SelectItem value="vertical">纵向</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  );
}

export function SerialDisplayWidgetControl({
  widget,
  latestValues,
  data,
}: {
  widget: SerialDisplayWidget;
  latestValues: Record<string, number>;
  data: SerialViewerData;
}) {
  if (widget.type === "gauge") {
    const value = latestValues[widget.channel];
    const percent = Number.isFinite(value)
      ? Math.min(100, Math.max(0, ((value - widget.min) / (widget.max - widget.min)) * 100))
      : 0;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{widget.label}</span>
          <span className="font-mono text-lg font-semibold">
            {Number.isFinite(value) ? value : "--"}
            {widget.unit}
          </span>
        </div>
        {widget.direction === "vertical" ? (
          <div className="mx-auto flex h-40 w-16 items-end overflow-hidden rounded-xl border border-border bg-muted/60">
            <div className="w-full bg-primary transition-[height]" style={{ height: `${percent}%` }} />
          </div>
        ) : (
          <div className="h-5 overflow-hidden rounded-full border border-border bg-muted/60">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        )}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{widget.min}</span>
          <span>{widget.channel ? `通道 ${widget.channel}` : "未绑定通道"}</span>
          <span>{widget.max}</span>
        </div>
      </div>
    );
  }

  if (widget.type === "value") {
    const value = latestValues[widget.channel];
    return (
      <div className="flex min-h-24 flex-col items-center justify-center text-center">
        <div className="text-sm text-muted-foreground">{widget.label}</div>
        <div className="mt-2 font-mono text-4xl font-semibold tracking-tight text-foreground">
          {Number.isFinite(value) ? value : "--"}
          <span className="ml-1 text-base font-normal text-muted-foreground">{widget.unit}</span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {widget.channel ? `通道 ${widget.channel}` : "未绑定通道"}
        </div>
      </div>
    );
  }

  if (widget.type === "indicator") {
    const value = latestValues[widget.channel];
    const available = Number.isFinite(value);
    const active = available && value >= widget.threshold;
    return (
      <div className="flex min-h-24 items-center justify-between gap-4">
        <div>
          <div className="font-medium text-foreground">{widget.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {available ? `${widget.channel} = ${value}` : widget.channel ? "等待通道数据" : "未绑定通道"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-sm font-medium", active ? "text-green-600" : "text-muted-foreground")}>
            {available ? (active ? "已触发" : "未触发") : "--"}
          </span>
          <span
            className={cn(
              "h-8 w-8 rounded-full border-4 border-white shadow-[0_0_0_1px_hsl(var(--border))] transition-colors",
              active ? "bg-green-500 shadow-[0_0_18px_rgba(34,197,94,0.7)]" : "bg-muted"
            )}
            aria-label={active ? "状态灯已点亮" : "状态灯未点亮"}
          />
        </div>
      </div>
    );
  }

  const direction = widget.direction === "all" ? undefined : widget.direction;
  return (
    <SerialViewer
      direction={direction}
      title={`${widget.label} · ${widget.direction === "all" ? "全部" : widget.direction.toUpperCase()}`}
      data={data}
    />
  );
}
