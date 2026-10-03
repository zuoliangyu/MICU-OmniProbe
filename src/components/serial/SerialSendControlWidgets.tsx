import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  joystickPointFromRatio,
  parseSerialCommandSequence,
  renderSerialControlCommand,
  renderSerialJoystickCommand,
  SERIAL_CONTROL_WIDGET_GROUPS,
  type SerialControlWidget,
  type SerialControlWidgetType,
} from "@/lib/serialControlPanel";
import { cn } from "@/lib/utils";

export type SerialSendWidget = Extract<
  SerialControlWidget,
  { type: "button" | "toggle" | "slider" | "input" | "stepper" | "joystick" | "sequence" }
>;

export type SerialSendRuntimeValue = string | number | boolean | { x: number; y: number };

const SEND_WIDGET_TYPES = new Set<SerialControlWidgetType>(
  SERIAL_CONTROL_WIDGET_GROUPS.find(({ title }) => title === "发送控制")?.items.map(({ type }) => type) ?? []
);

export function isSerialSendWidget(widget: SerialControlWidget): widget is SerialSendWidget {
  return SEND_WIDGET_TYPES.has(widget.type);
}

export function SerialSendWidgetEditor({
  widget,
  onChange,
}: {
  widget: SerialSendWidget;
  onChange: (widget: SerialSendWidget) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label>发送格式</Label>
        <Select value={widget.format} onValueChange={(format: "text" | "hex") => onChange({ ...widget, format })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">文本</SelectItem>
            <SelectItem value="hex">HEX</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {widget.type === "button" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${widget.id}-command`}>点击时发送</Label>
          <Input
            id={`${widget.id}-command`}
            value={widget.command}
            onChange={(event) => onChange({ ...widget, command: event.target.value })}
            className="font-mono"
          />
        </div>
      )}

      {widget.type === "sequence" && (
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${widget.id}-commands`}>命令列表</Label>
            <textarea
              id={`${widget.id}-commands`}
              value={widget.commands}
              rows={5}
              onChange={(event) => onChange({ ...widget, commands: event.target.value })}
              className="w-full resize-y rounded-[14px] border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
              placeholder={"AT\nAT+GMR"}
            />
            <p className="text-xs text-muted-foreground">每行一条命令，空行自动忽略。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${widget.id}-interval`}>命令间隔 (ms)</Label>
            <Input
              id={`${widget.id}-interval`}
              type="number"
              min={0}
              max={60000}
              value={widget.intervalMs}
              onChange={(event) => onChange({ ...widget, intervalMs: Number(event.target.value) })}
            />
          </div>
        </div>
      )}

      {widget.type === "toggle" && (
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${widget.id}-on`}>开启时发送</Label>
            <Input
              id={`${widget.id}-on`}
              value={widget.onCommand}
              onChange={(event) => onChange({ ...widget, onCommand: event.target.value })}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${widget.id}-off`}>关闭时发送</Label>
            <Input
              id={`${widget.id}-off`}
              value={widget.offCommand}
              onChange={(event) => onChange({ ...widget, offCommand: event.target.value })}
              className="font-mono"
            />
          </div>
        </div>
      )}

      {(widget.type === "slider" ||
        widget.type === "input" ||
        widget.type === "stepper" ||
        widget.type === "joystick") && (
        <div className="space-y-1.5">
          <Label htmlFor={`${widget.id}-template`}>发送模板</Label>
          <Input
            id={`${widget.id}-template`}
            value={widget.template}
            onChange={(event) => onChange({ ...widget, template: event.target.value })}
            placeholder={
              widget.type === "joystick" ? "X={x},Y={y}" : widget.type === "stepper" ? "PARAM={value}" : "PWM={value}"
            }
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {widget.type === "joystick" ? (
              <>
                使用 {"{x}"} 和 {"{y}"} 表示摇杆坐标。
              </>
            ) : (
              <>使用 {"{value}"} 表示当前控件值。</>
            )}
          </p>
        </div>
      )}

      {(widget.type === "slider" || widget.type === "stepper") && (
        <div className="grid gap-3">
          {(["min", "max", "step"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`${widget.id}-${key}`}>
                {key === "min" ? "最小值" : key === "max" ? "最大值" : "步长"}
              </Label>
              <Input
                id={`${widget.id}-${key}`}
                type="number"
                value={widget[key]}
                onChange={(event) => onChange({ ...widget, [key]: Number(event.target.value) })}
              />
            </div>
          ))}
          {widget.type === "slider" && (
            <div className="space-y-1.5">
              <Label>发送方式</Label>
              <Select
                value={widget.sendMode}
                onValueChange={(sendMode: "release" | "continuous") => onChange({ ...widget, sendMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="release">松手发送</SelectItem>
                  <SelectItem value="continuous">连续发送</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {widget.type === "joystick" && (
        <div className="space-y-3">
          <div className="grid gap-3">
            {(["xMin", "xMax", "yMin", "yMax", "step"] as const).map((key) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`${widget.id}-${key}`}>
                  {key === "xMin"
                    ? "X 最小值"
                    : key === "xMax"
                      ? "X 最大值"
                      : key === "yMin"
                        ? "Y 最小值"
                        : key === "yMax"
                          ? "Y 最大值"
                          : "步长"}
                </Label>
                <Input
                  id={`${widget.id}-${key}`}
                  type="number"
                  value={widget[key]}
                  onChange={(event) => onChange({ ...widget, [key]: Number(event.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>发送方式</Label>
              <Select
                value={widget.sendMode}
                onValueChange={(sendMode: "release" | "continuous") => onChange({ ...widget, sendMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="release">松手发送</SelectItem>
                  <SelectItem value="continuous">连续发送</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between rounded-lg border border-border/60 px-3 py-2">
              <div>
                <Label htmlFor={`${widget.id}-recenter`}>松手回中</Label>
                <p className="text-xs text-muted-foreground">松手后发送中心坐标。</p>
              </div>
              <Switch
                id={`${widget.id}-recenter`}
                checked={widget.recenter}
                onCheckedChange={(recenter) => onChange({ ...widget, recenter })}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function SerialSendWidgetControl({
  widget,
  sendEnabled,
  runtimeValue,
  runningSequenceId,
  onRuntimeValueChange,
  onUpdateWidget,
  onSend,
  onRunSequence,
}: {
  widget: SerialSendWidget;
  sendEnabled: boolean;
  runtimeValue: SerialSendRuntimeValue | undefined;
  runningSequenceId: string | null;
  onRuntimeValueChange: (value: SerialSendRuntimeValue) => void;
  onUpdateWidget: (updater: (widget: SerialSendWidget) => SerialSendWidget) => void;
  onSend: (widget: SerialSendWidget, command: string) => Promise<boolean>;
  onRunSequence: (widget: Extract<SerialSendWidget, { type: "sequence" }>) => Promise<void>;
}) {
  const lastContinuousSendRef = useRef(0);

  if (widget.type === "button") {
    return (
      <Button className="h-12 w-full" disabled={!sendEnabled} onClick={() => void onSend(widget, widget.command)}>
        <Send className="mr-2 h-4 w-4" />
        {widget.label}
      </Button>
    );
  }

  if (widget.type === "sequence") {
    const commands = parseSerialCommandSequence(widget.commands);
    const running = runningSequenceId === widget.id;
    return (
      <div className="space-y-2">
        <Button
          className="h-12 w-full"
          disabled={!sendEnabled || runningSequenceId !== null || commands.length === 0}
          onClick={() => void onRunSequence(widget)}
        >
          <Send className="mr-2 h-4 w-4" />
          {running ? "正在执行…" : widget.label}
        </Button>
        <div className="text-center text-xs text-muted-foreground">
          {commands.length} 条命令 · 间隔 {widget.intervalMs}ms
        </div>
      </div>
    );
  }

  if (widget.type === "toggle") {
    const checked = Boolean(runtimeValue ?? widget.value);
    return (
      <div className="flex items-center justify-between gap-4 py-2">
        <div>
          <div className="font-medium text-foreground">{widget.label}</div>
          <div className="text-xs text-muted-foreground">{checked ? "已开启" : "已关闭"}</div>
        </div>
        <Switch
          checked={checked}
          disabled={!sendEnabled}
          onCheckedChange={async (next) => {
            onRuntimeValueChange(next);
            const sent = await onSend(widget, next ? widget.onCommand : widget.offCommand);
            if (sent) {
              onUpdateWidget((current) => (current.type === "toggle" ? { ...current, value: next } : current));
            } else onRuntimeValueChange(checked);
          }}
        />
      </div>
    );
  }

  if (widget.type === "slider") {
    const value = Number(runtimeValue ?? widget.value);
    const sendValue = (next: number) => onSend(widget, renderSerialControlCommand(widget.template, next));
    const handleChange = (next: number) => {
      onRuntimeValueChange(next);
      if (widget.sendMode !== "continuous") return;
      const now = Date.now();
      if (now - lastContinuousSendRef.current < 100) return;
      lastContinuousSendRef.current = now;
      void sendValue(next);
    };
    const commitValue = (next: number) => {
      onUpdateWidget((current) => (current.type === "slider" ? { ...current, value: next } : current));
      void sendValue(next);
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{widget.label}</span>
          <span className="rounded-full bg-secondary px-3 py-1 font-mono text-sm">{value}</span>
        </div>
        <input
          type="range"
          min={widget.min}
          max={widget.max}
          step={widget.step}
          value={value}
          disabled={!sendEnabled}
          onChange={(event) => handleChange(Number(event.target.value))}
          onPointerUp={(event) => commitValue(Number(event.currentTarget.value))}
          onKeyUp={(event) => commitValue(Number(event.currentTarget.value))}
          className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{widget.min}</span>
          <span>{widget.sendMode === "continuous" ? "连续发送 · 100ms 节流" : "松手发送"}</span>
          <span>{widget.max}</span>
        </div>
      </div>
    );
  }

  if (widget.type === "stepper") {
    const rawValue = runtimeValue ?? widget.value;
    const numericValue = Number(rawValue);
    const commitValue = (raw: number) => {
      const value = Number(
        Math.min(widget.max, Math.max(widget.min, Number.isFinite(raw) ? raw : widget.value)).toFixed(10)
      );
      onRuntimeValueChange(value);
      onUpdateWidget((current) => (current.type === "stepper" ? { ...current, value } : current));
      void onSend(widget, renderSerialControlCommand(widget.template, value));
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{widget.label}</span>
          <span className="text-xs text-muted-foreground">
            步长 {widget.step} · {widget.min}～{widget.max}
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2">
          <Button
            size="icon"
            variant="outline"
            disabled={!sendEnabled}
            onClick={() => commitValue(numericValue - widget.step)}
            aria-label={`${widget.label}减小`}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            type="number"
            min={widget.min}
            max={widget.max}
            step={widget.step}
            value={rawValue as string | number}
            disabled={!sendEnabled}
            onChange={(event) => onRuntimeValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitValue(Number(event.currentTarget.value));
            }}
            className="text-center font-mono"
            aria-label={`${widget.label}数值`}
          />
          <Button
            size="icon"
            variant="outline"
            disabled={!sendEnabled}
            onClick={() => commitValue(numericValue + widget.step)}
            aria-label={`${widget.label}增大`}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon" disabled={!sendEnabled} onClick={() => commitValue(numericValue)} title="发送当前值">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (widget.type === "joystick") {
    const point = typeof runtimeValue === "object" ? runtimeValue : { x: widget.x, y: widget.y };
    const left = ((point.x - widget.xMin) / (widget.xMax - widget.xMin)) * 100;
    const top = ((widget.yMax - point.y) / (widget.yMax - widget.yMin)) * 100;
    const sendPoint = (next: { x: number; y: number }) =>
      onSend(widget, renderSerialJoystickCommand(widget.template, next.x, next.y));
    const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return joystickPointFromRatio(
        widget,
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height
      );
    };
    const move = (next: { x: number; y: number }) => {
      onRuntimeValueChange(next);
      if (widget.sendMode !== "continuous") return;
      const now = Date.now();
      if (now - lastContinuousSendRef.current < 100) return;
      lastContinuousSendRef.current = now;
      void sendPoint(next);
    };
    const finish = async (next: { x: number; y: number }) => {
      await sendPoint(next);
      const settled = widget.recenter ? joystickPointFromRatio(widget, 0.5, 0.5) : next;
      onRuntimeValueChange(settled);
      onUpdateWidget((current) => (current.type === "joystick" ? { ...current, x: settled.x, y: settled.y } : current));
      if (widget.recenter) await sendPoint(settled);
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{widget.label}</span>
          <span className="rounded-full bg-secondary px-3 py-1 font-mono text-sm">
            X {point.x} · Y {point.y}
          </span>
        </div>
        <div
          role="application"
          tabIndex={sendEnabled ? 0 : -1}
          aria-label={`${widget.label}摇杆，X ${point.x}，Y ${point.y}`}
          className={cn(
            "relative mx-auto aspect-square w-full max-w-48 touch-none overflow-hidden rounded-full border border-border bg-muted/60",
            !sendEnabled && "cursor-not-allowed opacity-50"
          )}
          onPointerDown={(event) => {
            if (!sendEnabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            move(pointFromEvent(event));
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) move(pointFromEvent(event));
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const next = pointFromEvent(event);
            event.currentTarget.releasePointerCapture(event.pointerId);
            void finish(next);
          }}
          onKeyDown={(event) => {
            const offset =
              event.key === "ArrowLeft"
                ? [-widget.step, 0]
                : event.key === "ArrowRight"
                  ? [widget.step, 0]
                  : event.key === "ArrowUp"
                    ? [0, widget.step]
                    : event.key === "ArrowDown"
                      ? [0, -widget.step]
                      : null;
            if (!offset) return;
            event.preventDefault();
            const next = joystickPointFromRatio(
              widget,
              (point.x + offset[0] - widget.xMin) / (widget.xMax - widget.xMin),
              (widget.yMax - point.y - offset[1]) / (widget.yMax - widget.yMin)
            );
            onRuntimeValueChange(next);
            onUpdateWidget((current) => (current.type === "joystick" ? { ...current, x: next.x, y: next.y } : current));
            void sendPoint(next);
          }}
        >
          <div className="absolute left-1/2 top-0 h-full w-px bg-border/80" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-border/80" />
          <div
            className="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20 shadow-md"
            style={{ left: `${left}%`, top: `${top}%` }}
          />
        </div>
        <div className="text-center text-xs text-muted-foreground">
          {widget.sendMode === "continuous" ? "连续发送 · 100ms 节流" : "松手发送"}
          {widget.recenter ? " · 松手回中" : ""}
        </div>
      </div>
    );
  }

  const value = String(runtimeValue ?? widget.value);
  const sendInput = async () => {
    const sent = await onSend(widget, renderSerialControlCommand(widget.template, value));
    if (sent) {
      onUpdateWidget((current) => (current.type === "input" ? { ...current, value } : current));
    }
  };
  return (
    <div className="space-y-2">
      <Label htmlFor={`${widget.id}-runtime`}>{widget.label}</Label>
      <div className="flex gap-2">
        <Input
          id={`${widget.id}-runtime`}
          value={value}
          disabled={!sendEnabled}
          onChange={(event) => onRuntimeValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void sendInput();
          }}
        />
        <Button size="icon" disabled={!sendEnabled} onClick={() => void sendInput()} title="发送">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
