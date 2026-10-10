import { ExternalLink, Maximize2, Plus, Trash2 } from "lucide-react";
import { SignalPlotCanvas } from "@/components/rtt/SignalPlotCanvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ImuRotationComponent } from "@/lib/imuRotation";
import { useChartWorkspaceControls } from "@/hooks/useChartWorkspaceHost";
import type { ChartConfig, ChartDataPoint, ChartSeries } from "@/lib/chartTypes";
import {
  SERIAL_CONTROL_WIDGET_GROUPS,
  type SerialControlWidget,
  type SerialControlWidgetType,
  type SerialImu3dWidget,
} from "@/lib/serialControlPanel";
import type { ControlPanelSource } from "@/stores/controlPanelStore";
import { SerialControlMiniChart } from "./SerialControlMiniChart";
import { SerialImu3DControl } from "./SerialImu3D";

export type SerialVisualizationWidget = Extract<
  SerialControlWidget,
  { type: "yt-chart" | "fft-chart" | "xy-chart" | "imu-3d" }
>;

const VISUALIZATION_WIDGET_TYPES = new Set<SerialControlWidgetType>(
  SERIAL_CONTROL_WIDGET_GROUPS.find(({ title }) => title === "可视化")?.items.map(({ type }) => type) ?? []
);

export function isSerialVisualizationWidget(widget: SerialControlWidget): widget is SerialVisualizationWidget {
  return VISUALIZATION_WIDGET_TYPES.has(widget.type);
}

export function SerialVisualizationWidgetEditor({
  widget,
  onChange,
}: {
  widget: SerialVisualizationWidget;
  onChange: (widget: SerialVisualizationWidget) => void;
}) {
  return (
    <>
      {(widget.type === "fft-chart" || widget.type === "yt-chart") && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Y 通道（最多 6 个）</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={widget.channels.length >= 6}
              onClick={() => onChange({ ...widget, channels: [...widget.channels, ""] })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加
            </Button>
          </div>
          {widget.channels.map((channel, index) => (
            <div key={`${widget.id}-channel-${index}`} className="flex gap-2">
              <Input
                list="serial-control-channels"
                value={channel}
                onChange={(event) => {
                  const channels = [...widget.channels];
                  channels[index] = event.target.value;
                  onChange({ ...widget, channels });
                }}
                placeholder={`Y${index + 1}，例如 ch${index + 1}`}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0 text-red-500"
                onClick={() =>
                  onChange({ ...widget, channels: widget.channels.filter((_, itemIndex) => itemIndex !== index) })
                }
                title="删除通道"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {widget.channels.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {widget.type === "fft-chart" ? "留空时跟随图形工作台中已启用的通道。" : "添加一个或多个 Y 通道。"}
            </p>
          )}
        </div>
      )}

      {widget.type === "xy-chart" && (
        <div className="grid gap-3">
          {(["xChannel", "yChannel"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`${widget.id}-${key}`}>{key === "xChannel" ? "X 通道 key" : "Y 通道 key"}</Label>
              <Input
                id={`${widget.id}-${key}`}
                list="serial-control-channels"
                value={widget[key]}
                onChange={(event) => onChange({ ...widget, [key]: event.target.value })}
              />
            </div>
          ))}
        </div>
      )}

      {(widget.type === "xy-chart" || widget.type === "yt-chart" || widget.type === "fft-chart") && (
        <div className="space-y-1.5">
          <Label htmlFor={`${widget.id}-point-limit`}>显示点数</Label>
          <Input
            id={`${widget.id}-point-limit`}
            type="number"
            min={10}
            max={2000}
            value={widget.pointLimit}
            onChange={(event) => onChange({ ...widget, pointLimit: Number(event.target.value) })}
          />
          <p className="text-xs text-muted-foreground">使用波形解析缓存中的最近 10–2000 个点。</p>
        </div>
      )}

      {widget.type === "yt-chart" && (
        <div className="space-y-1.5">
          <Label>波形连接方式</Label>
          <Select
            value={widget.interpolation}
            onValueChange={(interpolation: "linear" | "smooth") => onChange({ ...widget, interpolation })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="linear">直线连接</SelectItem>
              <SelectItem value="smooth">平滑曲线</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {widget.type === "imu-3d" && (
        <div className="space-y-3">
          <div className="max-w-48 space-y-1.5">
            <Label>数据源</Label>
            <Select
              value={widget.sourceMode}
              onValueChange={(sourceMode: SerialImu3dWidget["sourceMode"]) => onChange({ ...widget, sourceMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="euler">欧拉角直驱</SelectItem>
                <SelectItem value="imu6">原始六轴融合</SelectItem>
                <SelectItem value="quat">四元数直驱</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {widget.sourceMode === "euler" ? (
            <>
              <div className="grid gap-3">
                {(["rollChannel", "pitchChannel", "yawChannel"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>
                      {key === "rollChannel"
                        ? "Roll / X 通道"
                        : key === "pitchChannel"
                          ? "Pitch / Y 通道"
                          : "Yaw / Z 通道"}
                    </Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      list="serial-control-channels"
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="max-w-48 space-y-1.5">
                <Label>输入角度单位</Label>
                <Select
                  value={widget.angleUnit}
                  onValueChange={(angleUnit: "deg" | "rad") => onChange({ ...widget, angleUnit })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deg">角度 (°)</SelectItem>
                    <SelectItem value="rad">弧度 (rad)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : widget.sourceMode === "quat" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(["quatWChannel", "quatXChannel", "quatYChannel", "quatZChannel"] as const).map((key, index) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>{"WXYZ"[index]} 通道</Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      list="serial-control-channels"
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                按分量分别绑定，设备按 xyzw 还是 wxyz 顺序输出都可以；自动归一化，全零时视为无效。
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-3">
                {(["accelXChannel", "accelYChannel", "accelZChannel"] as const).map((key, index) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>加速度 {"XYZ"[index]} 通道</Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      list="serial-control-channels"
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                {(["gyroXChannel", "gyroYChannel", "gyroZChannel"] as const).map((key, index) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>陀螺仪 {"XYZ"[index]} 通道</Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      list="serial-control-channels"
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label>陀螺仪单位</Label>
                  <Select
                    value={widget.gyroUnit}
                    onValueChange={(gyroUnit: "dps" | "rad") => onChange({ ...widget, gyroUnit })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dps">度/秒 (°/s)</SelectItem>
                      <SelectItem value="rad">弧度/秒 (rad/s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(["sampleRateHz", "filterAlpha"] as const).map((key) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>
                      {key === "sampleRateHz" ? "兜底采样率 (Hz)" : "滤波系数 α"}
                    </Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      type="number"
                      min={key === "sampleRateHz" ? 1 : 0}
                      max={key === "sampleRateHz" ? 10000 : 1}
                      step={key === "sampleRateHz" ? 1 : 0.01}
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: Number(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <div className="grid gap-3">
                {(["gyroBiasX", "gyroBiasY", "gyroBiasZ"] as const).map((key, index) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`${widget.id}-${key}`}>陀螺零偏 {"XYZ"[index]}</Label>
                    <Input
                      id={`${widget.id}-${key}`}
                      type="number"
                      step="any"
                      value={widget[key]}
                      onChange={(event) => onChange({ ...widget, [key]: Number(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                加速度单位可为 g 或 m/s²，但三个轴必须一致；设备静止时可在运行模式点击“静止校准”。
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">按 X=Roll、Y=Pitch、Z=Yaw 映射；运行模式可用当前姿态归零。</p>
          <ImuOverlayEditor widget={widget} onChange={onChange} />
        </div>
      )}
    </>
  );
}

const OVERLAY_EULER_LABELS = ["Roll / X", "Pitch / Y", "Yaw / Z"];
const OVERLAY_QUAT_LABELS = ["W", "X", "Y", "Z"];

/** 叠加旋转：在输入姿态上再合成一个由通道或固定值给出的旋转，例如云台电机角、机械臂上一级关节 */
function ImuOverlayEditor({
  widget,
  onChange,
}: {
  widget: SerialImu3dWidget;
  onChange: (widget: SerialImu3dWidget) => void;
}) {
  const key = widget.overlayMode === "quat" ? "overlayQuat" : "overlayEuler";
  const labels = widget.overlayMode === "quat" ? OVERLAY_QUAT_LABELS : OVERLAY_EULER_LABELS;
  const updateComponent = (index: number, patch: Partial<ImuRotationComponent>) =>
    onChange({
      ...widget,
      [key]: widget[key].map((component, itemIndex) => (itemIndex === index ? { ...component, ...patch } : component)),
    });

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor={`${widget.id}-overlay`}>叠加旋转</Label>
          <p className="text-xs text-muted-foreground">再合成一个来自通道或固定值的旋转，如云台电机角、上一级关节。</p>
        </div>
        <Switch
          id={`${widget.id}-overlay`}
          checked={widget.overlayEnabled}
          onCheckedChange={(overlayEnabled) => onChange({ ...widget, overlayEnabled })}
        />
      </div>
      {widget.overlayEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>表示方式</Label>
              <Select
                value={widget.overlayMode}
                onValueChange={(overlayMode: SerialImu3dWidget["overlayMode"]) => onChange({ ...widget, overlayMode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="euler">欧拉角</SelectItem>
                  <SelectItem value="quat">四元数</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {widget.overlayMode === "euler" && (
              <div className="space-y-1.5">
                <Label>角度单位</Label>
                <Select
                  value={widget.overlayAngleUnit}
                  onValueChange={(overlayAngleUnit: "deg" | "rad") => onChange({ ...widget, overlayAngleUnit })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deg">角度 (°)</SelectItem>
                    <SelectItem value="rad">弧度 (rad)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>叠加位置</Label>
            <Select
              value={widget.overlayOrder}
              onValueChange={(overlayOrder: SerialImu3dWidget["overlayOrder"]) => onChange({ ...widget, overlayOrder })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">本体坐标系（输入 × 叠加）</SelectItem>
                <SelectItem value="world">世界坐标系（叠加 × 输入）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              本体：绕传感器自身的轴再转，适合安装角补偿；世界：绕固定的外部轴转，适合叠加底座或上一级关节的转角。
            </p>
          </div>
          <div className="space-y-2">
            {widget[key].map((component, index) => (
              <div key={labels[index]} className="grid grid-cols-[3.5rem_6rem_minmax(0,1fr)] items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{labels[index]}</span>
                <Select
                  value={component.source}
                  onValueChange={(source: ImuRotationComponent["source"]) => updateComponent(index, { source })}
                >
                  <SelectTrigger aria-label={`${labels[index]} 来源`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="constant">固定值</SelectItem>
                    <SelectItem value="channel">通道</SelectItem>
                  </SelectContent>
                </Select>
                {component.source === "channel" ? (
                  <Input
                    aria-label={`${labels[index]} 通道`}
                    list="serial-control-channels"
                    value={component.channel}
                    placeholder="通道 key"
                    onChange={(event) => updateComponent(index, { channel: event.target.value })}
                  />
                ) : (
                  <Input
                    aria-label={`${labels[index]} 数值`}
                    type="number"
                    step="any"
                    value={component.value}
                    onChange={(event) => updateComponent(index, { value: Number(event.target.value) })}
                  />
                )}
              </div>
            ))}
          </div>
          {widget.overlayMode === "quat" && (
            <p className="text-xs text-muted-foreground">叠加四元数同样自动归一化，默认 1, 0, 0, 0 表示不旋转。</p>
          )}
        </>
      )}
    </div>
  );
}

function SerialSignalPreview({
  widget,
  showWorkspaceActions,
  source,
  chartData,
  rawChartData,
  filterActive,
  chartConfig,
  onOpenChart,
}: {
  widget: Extract<SerialVisualizationWidget, { type: "yt-chart" | "fft-chart" }>;
  showWorkspaceActions: boolean;
  source: ControlPanelSource;
  chartData: ChartDataPoint[];
  rawChartData?: ChartDataPoint[];
  filterActive: boolean;
  chartConfig: ChartConfig;
  onOpenChart: () => void;
}) {
  const { openDetachedWindow } = useChartWorkspaceControls(source);
  const domain = widget.type === "fft-chart" ? "fft" : "time";
  const channelKeys =
    widget.channels.length > 0
      ? widget.channels
      : chartConfig.channels.filter((item) => item.visible).map((item) => item.key);
  const series: ChartSeries[] = channelKeys.slice(0, 6).map((key, index) => {
    const configured = chartConfig.channels.find((item) => item.key === key);
    return (
      configured ?? {
        key,
        name: key,
        color: ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4"][index % 6],
        visible: true,
      }
    );
  });
  const visibleChartData = chartData.slice(-widget.pointLimit);
  const visibleRawChartData = rawChartData?.slice(-widget.pointLimit);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">{widget.label}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] uppercase">{domain}</span>
        {showWorkspaceActions && (
          <div className="ml-auto flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onOpenChart} title="打开图形工作台">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => void openDetachedWindow()}
              title="独立窗口"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background/70">
        {series.length > 0 ? (
          <SignalPlotCanvas
            chartData={visibleChartData}
            rawChartData={visibleRawChartData}
            filterActive={filterActive}
            series={series}
            chartConfig={{
              ...chartConfig,
              visiblePointLimit: widget.pointLimit,
              waveformInterpolation:
                widget.type === "yt-chart" ? widget.interpolation : chartConfig.waveformInterpolation,
            }}
            domain={domain}
            className="h-full"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            请在右侧绑定显示通道
          </div>
        )}
      </div>
    </div>
  );
}

export function SerialVisualizationWidgetControl({
  widget,
  showWorkspaceActions,
  source,
  chartData,
  rawChartData,
  filterActive,
  chartConfig,
  latestValues,
  onOpenChart,
  onUpdateImu,
}: {
  widget: SerialVisualizationWidget;
  showWorkspaceActions: boolean;
  source: ControlPanelSource;
  chartData: ChartDataPoint[];
  rawChartData?: ChartDataPoint[];
  filterActive: boolean;
  chartConfig: ChartConfig;
  latestValues: Record<string, number>;
  onOpenChart: () => void;
  onUpdateImu: (patch: Partial<SerialImu3dWidget>) => void;
}) {
  if (widget.type === "yt-chart" || widget.type === "fft-chart") {
    return (
      <SerialSignalPreview
        widget={widget}
        showWorkspaceActions={showWorkspaceActions}
        source={source}
        chartData={chartData}
        rawChartData={rawChartData}
        filterActive={filterActive}
        chartConfig={chartConfig}
        onOpenChart={onOpenChart}
      />
    );
  }

  if (widget.type === "xy-chart") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{widget.label}</span>
          <span className="text-xs text-muted-foreground">
            {`${widget.xChannel || "X"} / ${widget.yChannel || "Y"}`}· 最近 {widget.pointLimit} 点
          </span>
        </div>
        <SerialControlMiniChart
          mode="xy"
          chartData={chartData}
          xChannel={widget.xChannel}
          yChannels={[widget.yChannel]}
          pointLimit={widget.pointLimit}
        />
      </div>
    );
  }

  return (
    <SerialImu3DControl widget={widget} chartData={chartData} latestValues={latestValues} onUpdate={onUpdateImu} />
  );
}
