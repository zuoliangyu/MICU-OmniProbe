import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChartDataPoint } from "@/lib/chartTypes";
import { estimateGyroBias, ImuFusionProcessor, type ImuOrientation } from "@/lib/imuFusion";
import { applySerialImuOffsets, resolveSerialImuAngles, type SerialImu3dWidget } from "@/lib/serialControlPanel";
import { cn } from "@/lib/utils";

interface SerialImu3DProps {
  roll: number;
  pitch: number;
  yaw: number;
  ready: boolean;
}

const FACES = [
  ["前", "translateZ(48px)", "bg-blue-600/90"],
  ["后", "rotateY(180deg) translateZ(48px)", "bg-orange-500/90"],
  ["右", "rotateY(90deg) translateZ(48px)", "bg-emerald-500/90"],
  ["左", "rotateY(-90deg) translateZ(48px)", "bg-fuchsia-600/90"],
  ["上", "rotateX(90deg) translateZ(48px)", "bg-violet-600/90"],
  ["下", "rotateX(-90deg) translateZ(48px)", "bg-amber-400/90 text-slate-950"],
] as const;

function useImu6Fusion(widget: SerialImu3dWidget, chartData: ChartDataPoint[]) {
  const processorRef = useRef(new ImuFusionProcessor());
  const [orientation, setOrientation] = useState<ImuOrientation | null>(null);

  useEffect(() => {
    if (widget.sourceMode !== "imu6") {
      processorRef.current.reset();
      setOrientation(null);
      return;
    }
    setOrientation(processorRef.current.process(chartData, widget));
  }, [chartData, widget]);

  return orientation;
}

interface SerialImu3DControlProps {
  widget: SerialImu3dWidget;
  chartData: ChartDataPoint[];
  latestValues: Record<string, number>;
  onUpdate: (patch: Partial<SerialImu3dWidget>) => void;
}

export function SerialImu3DControl({ widget, chartData, latestValues, onUpdate }: SerialImu3DControlProps) {
  const fused = useImu6Fusion(widget, chartData);
  const euler = widget.sourceMode === "euler" ? resolveSerialImuAngles(widget, latestValues) : null;
  const raw = widget.sourceMode === "imu6" ? fused : (euler?.raw ?? null);
  const display = raw ? applySerialImuOffsets(raw, widget) : { roll: 0, pitch: 0, yaw: 0 };

  return (
    <div className="serial-imu-container space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{widget.label}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {widget.sourceMode === "imu6" ? "六轴融合" : "欧拉角直驱"}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {widget.sourceMode === "imu6" && (
            <Button
              size="sm"
              variant="outline"
              disabled={chartData.length === 0}
              title="保持设备静止，使用最近 200 个采样点估计陀螺仪零偏"
              onClick={() => {
                const bias = estimateGyroBias(chartData.slice(-200), widget);
                if (bias) onUpdate({ gyroBiasX: bias.x, gyroBiasY: bias.y, gyroBiasZ: bias.z });
              }}
            >
              静止校准
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!raw}
            onClick={() => raw && onUpdate({ rollOffset: raw.roll, pitchOffset: raw.pitch, yawOffset: raw.yaw })}
          >
            当前姿态归零
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onUpdate({ rollOffset: 0, pitchOffset: 0, yawOffset: 0 })}>
            清除归零
          </Button>
        </div>
      </div>
      {widget.sourceMode === "imu6" && (
        <div className="text-xs text-muted-foreground">
          陀螺零偏：X {widget.gyroBiasX.toFixed(4)} · Y {widget.gyroBiasY.toFixed(4)} · Z {widget.gyroBiasZ.toFixed(4)}·
          无磁力计时 Yaw 会逐渐漂移
        </div>
      )}
      <SerialImu3D {...display} ready={Boolean(raw)} />
    </div>
  );
}

export function SerialImu3D({ roll, pitch, yaw, ready }: SerialImu3DProps) {
  return (
    <div className="serial-imu-grid grid min-h-72 gap-4">
      <div
        role="img"
        aria-label={`IMU 姿态，Roll ${roll.toFixed(1)} 度，Pitch ${pitch.toFixed(1)} 度，Yaw ${yaw.toFixed(1)} 度`}
        className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-[radial-gradient(circle_at_50%_35%,hsl(var(--primary)/0.12),transparent_55%)]"
        style={{ perspective: "620px" }}
      >
        <div className="absolute left-1/2 top-1/2 h-px w-52 -translate-x-1/2 bg-red-500/60" />
        <div className="absolute left-1/2 top-1/2 h-52 w-px -translate-y-1/2 bg-green-500/60" />
        <span className="absolute right-4 top-1/2 -translate-y-5 text-xs font-semibold text-red-500">X</span>
        <span className="absolute left-1/2 top-3 -translate-x-5 text-xs font-semibold text-green-600">Y</span>
        <span className="absolute left-1/2 top-1/2 translate-x-16 translate-y-14 text-xs font-semibold text-blue-600">
          Z
        </span>

        <div
          className={cn("relative h-24 w-24 transition-transform duration-100 ease-linear", !ready && "opacity-45")}
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateZ(${yaw}deg) rotateY(${pitch}deg) rotateX(${roll}deg)`,
          }}
        >
          {FACES.map(([label, transform, color]) => (
            <div
              key={label}
              className={cn(
                "absolute inset-0 flex items-center justify-center border border-white/45 text-xs font-semibold text-white shadow-inner",
                color
              )}
              style={{ transform }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid content-center gap-3">
        {(
          [
            ["Roll / X", roll, "text-red-500"],
            ["Pitch / Y", pitch, "text-green-600"],
            ["Yaw / Z", yaw, "text-blue-600"],
          ] as const
        ).map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
            <div className={cn("text-xs font-medium", color)}>{label}</div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{ready ? value.toFixed(2) : "--"}°</div>
          </div>
        ))}
      </div>
    </div>
  );
}
