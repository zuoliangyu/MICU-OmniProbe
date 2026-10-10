import type { WaveformInterpolation } from "./chartTypes";
import type { ImuOrientation } from "./imuFusion";
import {
  composeOverlay,
  eulerFromQuaternion,
  quaternionFromEuler,
  readQuaternionInput,
  resolveOverlayQuaternion,
  type ImuOverlayConfig,
  type ImuQuaternionInputConfig,
  type ImuRotationComponent,
} from "./imuRotation";

export const SERIAL_CONTROL_WIDGET_TYPES = [
  "button",
  "toggle",
  "slider",
  "input",
  "stepper",
  "joystick",
  "sequence",
  "value",
  "indicator",
  "gauge",
  "serial-log",
  "yt-chart",
  "fft-chart",
  "xy-chart",
  "imu-3d",
] as const;

export type SerialControlWidgetType = (typeof SERIAL_CONTROL_WIDGET_TYPES)[number];
export type SerialControlFormat = "text" | "hex";

interface SerialControlWidgetBase {
  id: string;
  type: SerialControlWidgetType;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  format: SerialControlFormat;
}

export interface SerialButtonWidget extends SerialControlWidgetBase {
  type: "button";
  command: string;
}

export interface SerialToggleWidget extends SerialControlWidgetBase {
  type: "toggle";
  onCommand: string;
  offCommand: string;
  value: boolean;
}

export interface SerialSliderWidget extends SerialControlWidgetBase {
  type: "slider";
  template: string;
  min: number;
  max: number;
  step: number;
  value: number;
  sendMode: "release" | "continuous";
}

export interface SerialInputWidget extends SerialControlWidgetBase {
  type: "input";
  template: string;
  value: string;
}

export interface SerialStepperWidget extends SerialControlWidgetBase {
  type: "stepper";
  template: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface SerialJoystickWidget extends SerialControlWidgetBase {
  type: "joystick";
  template: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  step: number;
  x: number;
  y: number;
  sendMode: "release" | "continuous";
  recenter: boolean;
}

export interface SerialSequenceWidget extends SerialControlWidgetBase {
  type: "sequence";
  commands: string;
  intervalMs: number;
}

export interface SerialGaugeWidget extends SerialControlWidgetBase {
  type: "gauge";
  channel: string;
  min: number;
  max: number;
  unit: string;
  direction: "horizontal" | "vertical";
}

export interface SerialValueWidget extends SerialControlWidgetBase {
  type: "value";
  channel: string;
  unit: string;
}

export interface SerialIndicatorWidget extends SerialControlWidgetBase {
  type: "indicator";
  channel: string;
  threshold: number;
}

export interface SerialLogWidget extends SerialControlWidgetBase {
  type: "serial-log";
  direction: "all" | "rx" | "tx";
}

export interface SerialFftChartWidget extends SerialControlWidgetBase {
  type: "fft-chart";
  channels: string[];
  pointLimit: number;
}

export interface SerialXyChartWidget extends SerialControlWidgetBase {
  type: "xy-chart";
  xChannel: string;
  yChannel: string;
  pointLimit: number;
}

export interface SerialYtChartWidget extends SerialControlWidgetBase {
  type: "yt-chart";
  channels: string[];
  pointLimit: number;
  interpolation: WaveformInterpolation;
}

export interface SerialImu3dWidget extends SerialControlWidgetBase, ImuQuaternionInputConfig, ImuOverlayConfig {
  type: "imu-3d";
  sourceMode: "euler" | "imu6" | "quat";
  rollChannel: string;
  pitchChannel: string;
  yawChannel: string;
  angleUnit: "deg" | "rad";
  accelXChannel: string;
  accelYChannel: string;
  accelZChannel: string;
  gyroXChannel: string;
  gyroYChannel: string;
  gyroZChannel: string;
  gyroUnit: "dps" | "rad";
  sampleRateHz: number;
  filterAlpha: number;
  gyroBiasX: number;
  gyroBiasY: number;
  gyroBiasZ: number;
  rollOffset: number;
  pitchOffset: number;
  yawOffset: number;
}

export type SerialControlWidget =
  | SerialButtonWidget
  | SerialToggleWidget
  | SerialSliderWidget
  | SerialInputWidget
  | SerialStepperWidget
  | SerialJoystickWidget
  | SerialSequenceWidget
  | SerialGaugeWidget
  | SerialValueWidget
  | SerialIndicatorWidget
  | SerialLogWidget
  | SerialFftChartWidget
  | SerialXyChartWidget
  | SerialYtChartWidget
  | SerialImu3dWidget;

export interface SerialControlPanelConfig {
  version: 4;
  name: string;
  widgets: SerialControlWidget[];
}

const STORAGE_KEY = "serial_control_panel";
const DEFAULT_PANEL: SerialControlPanelConfig = { version: 4, name: "默认控制面板", widgets: [] };
const LEGACY_CANVAS_WIDTH = 1200;
const LEGACY_GRID_GAP = 12;
const LEGACY_COLUMN_WIDTH = (LEGACY_CANVAS_WIDTH - LEGACY_GRID_GAP * 11) / 12;

export function clampFloatingPanelPosition(
  position: { x: number; y: number },
  container: { width: number; height: number },
  panel: { width: number; height: number },
  inset = 12
) {
  return {
    x: Math.min(0, Math.max(panel.width + inset * 2 - container.width, position.x)),
    y: Math.min(Math.max(0, container.height - panel.height - inset * 2), Math.max(0, position.y)),
  };
}
const LEGACY_ROW_HEIGHT = 48;

export interface SerialControlWidgetDefinition {
  type: SerialControlWidgetType;
  label: string;
  paletteLabel: string;
  group: "发送控制" | "数据显示" | "可视化";
  inputHelp: SerialControlWidgetInputHelp;
}

export interface SerialControlWidgetInputHelp {
  description: string;
  sampleLabel: string;
  example: string;
  flow: string;
  docId: SerialControlWidgetType;
}

interface InternalWidgetDefinition {
  type: SerialControlWidgetType;
  label: string;
  paletteLabel?: string;
  group: SerialControlWidgetDefinition["group"];
  inputHelp: Omit<SerialControlWidgetInputHelp, "docId">;
  defaults: () => Record<string, unknown>;
}

function inputHelp(description: string, sampleLabel: string, example: string, flow: string) {
  return { description, sampleLabel, example, flow };
}

const WIDGET_DEFINITIONS: readonly InternalWidgetDefinition[] = [
  {
    type: "button",
    label: "发送按钮",
    group: "发送控制",
    inputHelp: inputHelp(
      "点击后把命令原样发给设备。",
      "设备默认收到（TEXT）",
      "PING\\n",
      "点击 → PING → UTF-8 编码 → 追加 LF → 设备"
    ),
    defaults: () => ({ command: "PING" }),
  },
  {
    type: "toggle",
    label: "开关",
    group: "发送控制",
    inputHelp: inputHelp(
      "切换开关时分别发送开启或关闭命令。",
      "设备默认收到（TEXT）",
      "LED=1\\n  或  LED=0\\n",
      "切换状态 → 选择命令 → 编码并追加换行 → 设备"
    ),
    defaults: () => ({ onCommand: "LED=1", offCommand: "LED=0", value: false }),
  },
  {
    type: "slider",
    label: "滑块",
    group: "发送控制",
    inputHelp: inputHelp(
      "把当前数值替换模板中的 {value} 后发送。",
      "设备默认收到（TEXT）",
      "PWM=128\\n",
      "0–255 的值 → PWM={value} → 松手发送"
    ),
    defaults: () => ({ template: "PWM={value}", min: 0, max: 255, step: 1, value: 0, sendMode: "release" }),
  },
  {
    type: "input",
    label: "参数输入",
    group: "发送控制",
    inputHelp: inputHelp(
      "把输入内容替换模板中的 {value} 后发送。",
      "设备默认收到（TEXT）",
      "hello\\n",
      "用户输入 → {value} → 按 Enter 或发送按钮 → 设备"
    ),
    defaults: () => ({ template: "{value}", value: "" }),
  },
  {
    type: "stepper",
    label: "参数微调",
    group: "发送控制",
    inputHelp: inputHelp(
      "按步长调整数值并替换模板中的 {value}。",
      "设备默认收到（TEXT）",
      "PARAM=42\\n",
      "0–100 的值 → PARAM={value} → 设备"
    ),
    defaults: () => ({ template: "PARAM={value}", min: 0, max: 100, step: 1, value: 0 }),
  },
  {
    type: "joystick",
    label: "摇杆",
    group: "发送控制",
    inputHelp: inputHelp(
      "把二维坐标替换模板中的 {x}、{y} 后发送。",
      "设备默认收到（TEXT）",
      "X=25,Y=-40\\n",
      "摇杆坐标 → X={x},Y={y} → 最快每 100ms 发送"
    ),
    defaults: () => ({
      template: "X={x},Y={y}",
      xMin: -100,
      xMax: 100,
      yMin: -100,
      yMax: 100,
      step: 1,
      x: 0,
      y: 0,
      sendMode: "continuous",
      recenter: true,
    }),
  },
  {
    type: "sequence",
    label: "命令序列",
    group: "发送控制",
    inputHelp: inputHelp(
      "按从上到下的顺序发送多行命令。",
      "设备默认依次收到（TEXT）",
      "AT\\n  然后  AT+GMR\\n",
      "每个非空行 → 间隔 100ms → 编码并追加换行 → 设备"
    ),
    defaults: () => ({ commands: "AT\nAT+GMR", intervalMs: 100 }),
  },
  {
    type: "value",
    label: "接收数值",
    group: "数据显示",
    inputHelp: inputHelp(
      "显示一个数值通道的最新值。",
      "设备每行输出（JSON）",
      '{"temp":25.3}',
      "设备 → 解析为 temp → 接收通道 key 填 temp"
    ),
    defaults: () => ({ channel: "", unit: "" }),
  },
  {
    type: "indicator",
    label: "状态灯",
    group: "数据显示",
    inputHelp: inputHelp(
      "通道值达到阈值时点亮状态灯。",
      "设备每行输出（JSON）",
      '{"ready":1}',
      "设备 → 解析为 ready → 与阈值比较"
    ),
    defaults: () => ({ channel: "", threshold: 0.5 }),
  },
  {
    type: "gauge",
    label: "能量槽",
    group: "数据显示",
    inputHelp: inputHelp(
      "把通道最新值映射到配置的上下限。",
      "设备每行输出（JSON）",
      '{"battery":78}',
      "设备 → 解析为 battery → 映射到能量槽"
    ),
    defaults: () => ({ channel: "", min: 0, max: 100, unit: "%", direction: "horizontal" }),
  },
  {
    type: "serial-log",
    label: "串口日志",
    group: "数据显示",
    inputHelp: inputHelp(
      "显示已经按接收分帧规则切出的原始 RX/TX 行。",
      "设备可直接输出",
      "boot ok\\ntemp=25.3\\n",
      "设备字节 → 接收分帧 → 日志；不经过数值解析"
    ),
    defaults: () => ({ direction: "all", width: 780, height: 348 }),
  },
  {
    type: "yt-chart",
    label: "YT 一维曲线",
    paletteLabel: "YT 实时波形",
    group: "可视化",
    inputHelp: inputHelp(
      "以接收时间为横轴显示最多 6 个数值通道。",
      "设备每行输出（JSON）",
      '{"ch1":1.2,"ch2":3.4}',
      "设备 → 解析为 ch1/ch2 → Y 通道绑定"
    ),
    defaults: () => ({ channels: [], pointLimit: 200, interpolation: "linear", width: 780, height: 348 }),
  },
  {
    type: "fft-chart",
    label: "FFT 频谱",
    group: "可视化",
    inputHelp: inputHelp(
      "对最多 6 个时域数值通道实时计算频谱。",
      "设备连续逐行输出（JSON）",
      '{"ch1":1.2,"ch2":3.4}',
      "连续时域采样 → ch1/ch2 → FFT；不要输入频谱结果"
    ),
    defaults: () => ({ channels: [], pointLimit: 1024, width: 780, height: 348 }),
  },
  {
    type: "xy-chart",
    label: "XY 二维曲线",
    paletteLabel: "XY 曲线",
    group: "可视化",
    inputHelp: inputHelp(
      "分别使用一个 X 通道和一个 Y 通道绘制轨迹。",
      "设备每行输出（JSON）",
      '{"x":0.3,"y":0.8}',
      "同一采样帧 → x/y → 配对为一个轨迹点"
    ),
    defaults: () => ({ xChannel: "", yChannel: "", pointLimit: 200, width: 780, height: 348 }),
  },
  {
    type: "imu-3d",
    label: "IMU 3D 姿态",
    paletteLabel: "IMU 3D",
    group: "可视化",
    inputHelp: inputHelp(
      "欧拉角直驱分别读取 Roll、Pitch、Yaw。",
      "设备每行输出（JSON）",
      '{"roll":10.2,"pitch":-3.1,"yaw":45}',
      "同一采样帧 → roll/pitch/yaw → 3D 姿态"
    ),
    defaults: () => ({
      sourceMode: "euler",
      rollChannel: "roll",
      pitchChannel: "pitch",
      yawChannel: "yaw",
      angleUnit: "deg",
      accelXChannel: "ax",
      accelYChannel: "ay",
      accelZChannel: "az",
      gyroXChannel: "gx",
      gyroYChannel: "gy",
      gyroZChannel: "gz",
      gyroUnit: "dps",
      sampleRateHz: 100,
      filterAlpha: 0.98,
      gyroBiasX: 0,
      gyroBiasY: 0,
      gyroBiasZ: 0,
      rollOffset: 0,
      pitchOffset: 0,
      yawOffset: 0,
      ...DEFAULT_IMU_QUAT_INPUT,
      ...defaultImuOverlay(),
      width: 780,
      height: 348,
    }),
  },
];

const WIDGET_BY_TYPE = Object.fromEntries(
  WIDGET_DEFINITIONS.map((definition) => [definition.type, definition])
) as Record<SerialControlWidgetType, InternalWidgetDefinition>;

export const SERIAL_CONTROL_WIDGET_DEFINITIONS: readonly SerialControlWidgetDefinition[] = WIDGET_DEFINITIONS.map(
  ({ type, label, paletteLabel, group, inputHelp }) => ({
    type,
    label,
    paletteLabel: paletteLabel ?? label,
    group,
    inputHelp: { ...inputHelp, docId: type },
  })
);

export const SERIAL_CONTROL_WIDGET_GROUPS = (["发送控制", "数据显示", "可视化"] as const).map((title) => ({
  title,
  items: SERIAL_CONTROL_WIDGET_DEFINITIONS.filter(({ group }) => group === title).map(({ type, paletteLabel }) => ({
    type,
    label: paletteLabel,
  })),
}));

/** 组件类型的中文名（画布标题等处显示，不暴露内部类型 ID）。 */
export function getSerialControlWidgetTypeLabel(type: SerialControlWidgetType): string {
  return WIDGET_BY_TYPE[type].label;
}

export function isSerialControlWidgetType(value: unknown): value is SerialControlWidgetType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WIDGET_BY_TYPE, value);
}

export function getSerialControlWidgetInputHelp(widget: SerialControlWidget): SerialControlWidgetInputHelp {
  if (widget.type === "imu-3d" && widget.sourceMode === "quat") {
    return {
      ...inputHelp(
        "四元数直驱读取 W、X、Y、Z 四个分量，自动归一化。",
        "设备每行输出（JSON）",
        '{"qw":1,"qx":0,"qy":0,"qz":0}',
        "同一采样帧 → qw/qx/qy/qz → 3D 姿态"
      ),
      docId: widget.type,
    };
  }
  if (widget.type === "imu-3d" && widget.sourceMode === "imu6") {
    return {
      ...inputHelp(
        "六轴融合读取三轴加速度和三轴陀螺仪。",
        "设备每行输出（JSON）",
        '{"ax":0.01,"ay":0.02,"az":1,"gx":0.2,"gy":-0.1,"gz":0}',
        "同一采样帧 → ax/ay/az/gx/gy/gz → 姿态融合"
      ),
      docId: widget.type,
    };
  }
  return { ...WIDGET_BY_TYPE[widget.type].inputHelp, docId: widget.type };
}

function widgetId() {
  return globalThis.crypto?.randomUUID?.() ?? `widget-${Date.now()}`;
}

export function createSerialControlWidget(type: SerialControlWidgetType): SerialControlWidget {
  const definition = WIDGET_BY_TYPE[type];
  const base = {
    id: widgetId(),
    type,
    label: definition.label,
    left: 0,
    top: 0,
    width: 380,
    height: 168,
    format: "text" as const,
  };
  return { ...base, ...definition.defaults(), type } as SerialControlWidget;
}

const DEFAULT_IMU_QUAT_INPUT: ImuQuaternionInputConfig = {
  quatWChannel: "qw",
  quatXChannel: "qx",
  quatYChannel: "qy",
  quatZChannel: "qz",
};

const constantComponent = (value: number): ImuRotationComponent => ({ source: "constant", channel: "", value });

function defaultImuOverlay(): ImuOverlayConfig {
  return {
    overlayEnabled: false,
    overlayMode: "euler",
    overlayOrder: "local",
    overlayAngleUnit: "deg",
    overlayEuler: [0, 0, 0].map(constantComponent),
    overlayQuat: [1, 0, 0, 0].map(constantComponent),
  };
}

function normalizeRotationComponents(value: unknown, defaults: ImuRotationComponent[]): ImuRotationComponent[] {
  const items = Array.isArray(value) ? value : [];
  return defaults.map((fallback, index) => {
    const item = (items[index] ?? {}) as Partial<ImuRotationComponent>;
    return {
      source: item.source === "channel" ? "channel" : "constant",
      channel: stringValue(item.channel),
      value: finiteNumber(item.value, fallback.value),
    };
  });
}

function finiteNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function parseSerialControlPanel(raw: unknown): SerialControlPanelConfig {
  if (!raw || typeof raw !== "object") throw new Error("控制面板配置必须是 JSON 对象");
  const source = raw as Record<string, unknown>;
  if ((source.version !== 3 && source.version !== 4) || !Array.isArray(source.widgets)) {
    throw new Error("不支持的控制面板配置格式");
  }

  const usedIds = new Set<string>();
  let legacyX = 0;
  let legacyY = 0;
  let legacyRowHeight = 0;
  const widgets = source.widgets.flatMap((rawWidget, index): SerialControlWidget[] => {
    if (!rawWidget || typeof rawWidget !== "object") return [];
    const widget = rawWidget as Record<string, unknown>;
    const type = widget.type;
    if (!isSerialControlWidgetType(type)) return [];

    const candidateId = stringValue(widget.id, `${type}-${index + 1}`) || `${type}-${index + 1}`;
    const id = usedIds.has(candidateId) ? `${candidateId}-${index + 1}` : candidateId;
    usedIds.add(id);
    let left: number;
    let top: number;
    let width: number;
    let height: number;
    if (source.version === 3) {
      const columns = widget.columns === 8 || widget.columns === 12 ? widget.columns : 4;
      const rows = Math.min(12, Math.max(2, Math.round(finiteNumber(widget.rows, 3))));
      width = columns * LEGACY_COLUMN_WIDTH + (columns - 1) * LEGACY_GRID_GAP;
      height = rows * LEGACY_ROW_HEIGHT + (rows - 1) * LEGACY_GRID_GAP;
      if (legacyX > 0 && legacyX + width > LEGACY_CANVAS_WIDTH) {
        legacyX = 0;
        legacyY += legacyRowHeight + LEGACY_GRID_GAP;
        legacyRowHeight = 0;
      }
      left = legacyX;
      top = legacyY;
      legacyX += width + LEGACY_GRID_GAP;
      legacyRowHeight = Math.max(legacyRowHeight, height);
    } else {
      left = Math.max(0, finiteNumber(widget.left, 0));
      top = Math.max(0, finiteNumber(widget.top, 0));
      width = Math.min(2_400, Math.max(200, finiteNumber(widget.width, 380)));
      height = Math.min(2_000, Math.max(96, finiteNumber(widget.height, 168)));
    }
    const base = {
      id,
      type,
      label: stringValue(widget.label, WIDGET_BY_TYPE[type].label) || WIDGET_BY_TYPE[type].label,
      left,
      top,
      width,
      height,
      format: widget.format === "hex" ? ("hex" as const) : ("text" as const),
    };

    if (type === "button") return [{ ...base, type, command: stringValue(widget.command, "PING") }];
    if (type === "toggle") {
      return [
        {
          ...base,
          type,
          onCommand: stringValue(widget.onCommand, "LED=1"),
          offCommand: stringValue(widget.offCommand, "LED=0"),
          value: widget.value === true,
        },
      ];
    }
    if (type === "input") {
      return [{ ...base, type, template: stringValue(widget.template, "{value}"), value: stringValue(widget.value) }];
    }

    if (type === "stepper") {
      const min = finiteNumber(widget.min, 0);
      const maxCandidate = finiteNumber(widget.max, 100);
      const max = maxCandidate > min ? maxCandidate : min + 1;
      const stepCandidate = finiteNumber(widget.step, 1);
      return [
        {
          ...base,
          type,
          template: stringValue(widget.template, "PARAM={value}"),
          min,
          max,
          step: stepCandidate > 0 ? stepCandidate : 1,
          value: Math.min(max, Math.max(min, finiteNumber(widget.value, min))),
        },
      ];
    }

    if (type === "joystick") {
      const xMin = finiteNumber(widget.xMin, -100);
      const xMaxCandidate = finiteNumber(widget.xMax, 100);
      const xMax = xMaxCandidate > xMin ? xMaxCandidate : xMin + 1;
      const yMin = finiteNumber(widget.yMin, -100);
      const yMaxCandidate = finiteNumber(widget.yMax, 100);
      const yMax = yMaxCandidate > yMin ? yMaxCandidate : yMin + 1;
      const stepCandidate = finiteNumber(widget.step, 1);
      return [
        {
          ...base,
          type,
          template: stringValue(widget.template, "X={x},Y={y}"),
          xMin,
          xMax,
          yMin,
          yMax,
          step: stepCandidate > 0 ? stepCandidate : 1,
          x: Math.min(xMax, Math.max(xMin, finiteNumber(widget.x, (xMin + xMax) / 2))),
          y: Math.min(yMax, Math.max(yMin, finiteNumber(widget.y, (yMin + yMax) / 2))),
          sendMode: widget.sendMode === "release" ? "release" : "continuous",
          recenter: widget.recenter !== false,
        },
      ];
    }

    if (type === "sequence") {
      return [
        {
          ...base,
          type,
          commands: stringValue(widget.commands, "AT\nAT+GMR"),
          intervalMs: Math.min(60_000, Math.max(0, finiteNumber(widget.intervalMs, 100))),
        },
      ];
    }

    if (type === "indicator") {
      return [
        {
          ...base,
          type,
          channel: stringValue(widget.channel),
          threshold: finiteNumber(widget.threshold, 0.5),
        },
      ];
    }

    if (type === "serial-log") {
      return [
        {
          ...base,
          type,
          direction: widget.direction === "rx" || widget.direction === "tx" ? widget.direction : "all",
        },
      ];
    }

    if (type === "fft-chart") {
      return [
        {
          ...base,
          type,
          channels: Array.isArray(widget.channels)
            ? widget.channels.map((value) => stringValue(value)).filter(Boolean)
            : [],
          pointLimit: Math.min(2_000, Math.max(10, Math.round(finiteNumber(widget.pointLimit, 1024)))),
        },
      ];
    }

    if (type === "xy-chart") {
      return [
        {
          ...base,
          type,
          xChannel: stringValue(widget.xChannel),
          yChannel: stringValue(widget.yChannel),
          pointLimit: Math.min(2_000, Math.max(10, Math.round(finiteNumber(widget.pointLimit, 200)))),
        },
      ];
    }

    if (type === "yt-chart") {
      return [
        {
          ...base,
          type,
          channels: Array.isArray(widget.channels)
            ? widget.channels.map((value) => stringValue(value)).filter(Boolean)
            : [],
          pointLimit: Math.min(2_000, Math.max(10, Math.round(finiteNumber(widget.pointLimit, 200)))),
          interpolation: widget.interpolation === "smooth" ? "smooth" : "linear",
        },
      ];
    }

    if (type === "imu-3d") {
      return [
        {
          ...base,
          type,
          sourceMode: widget.sourceMode === "imu6" || widget.sourceMode === "quat" ? widget.sourceMode : "euler",
          rollChannel: stringValue(widget.rollChannel, "roll"),
          pitchChannel: stringValue(widget.pitchChannel, "pitch"),
          yawChannel: stringValue(widget.yawChannel, "yaw"),
          angleUnit: widget.angleUnit === "rad" ? "rad" : "deg",
          accelXChannel: stringValue(widget.accelXChannel, "ax"),
          accelYChannel: stringValue(widget.accelYChannel, "ay"),
          accelZChannel: stringValue(widget.accelZChannel, "az"),
          gyroXChannel: stringValue(widget.gyroXChannel, "gx"),
          gyroYChannel: stringValue(widget.gyroYChannel, "gy"),
          gyroZChannel: stringValue(widget.gyroZChannel, "gz"),
          gyroUnit: widget.gyroUnit === "rad" ? "rad" : "dps",
          sampleRateHz: Math.min(10_000, Math.max(1, finiteNumber(widget.sampleRateHz, 100))),
          filterAlpha: Math.min(1, Math.max(0, finiteNumber(widget.filterAlpha, 0.98))),
          gyroBiasX: finiteNumber(widget.gyroBiasX, 0),
          gyroBiasY: finiteNumber(widget.gyroBiasY, 0),
          gyroBiasZ: finiteNumber(widget.gyroBiasZ, 0),
          rollOffset: finiteNumber(widget.rollOffset, 0),
          pitchOffset: finiteNumber(widget.pitchOffset, 0),
          yawOffset: finiteNumber(widget.yawOffset, 0),
          quatWChannel: stringValue(widget.quatWChannel, DEFAULT_IMU_QUAT_INPUT.quatWChannel),
          quatXChannel: stringValue(widget.quatXChannel, DEFAULT_IMU_QUAT_INPUT.quatXChannel),
          quatYChannel: stringValue(widget.quatYChannel, DEFAULT_IMU_QUAT_INPUT.quatYChannel),
          quatZChannel: stringValue(widget.quatZChannel, DEFAULT_IMU_QUAT_INPUT.quatZChannel),
          overlayEnabled: widget.overlayEnabled === true,
          overlayMode: widget.overlayMode === "quat" ? "quat" : "euler",
          overlayOrder: widget.overlayOrder === "world" ? "world" : "local",
          overlayAngleUnit: widget.overlayAngleUnit === "rad" ? "rad" : "deg",
          overlayEuler: normalizeRotationComponents(widget.overlayEuler, defaultImuOverlay().overlayEuler),
          overlayQuat: normalizeRotationComponents(widget.overlayQuat, defaultImuOverlay().overlayQuat),
        },
      ];
    }

    if (type === "value") {
      return [{ ...base, type, channel: stringValue(widget.channel), unit: stringValue(widget.unit) }];
    }

    if (type === "gauge") {
      const min = finiteNumber(widget.min, 0);
      const maxCandidate = finiteNumber(widget.max, 100);
      return [
        {
          ...base,
          type,
          channel: stringValue(widget.channel),
          min,
          max: maxCandidate > min ? maxCandidate : min + 1,
          unit: stringValue(widget.unit, "%"),
          direction: widget.direction === "vertical" ? "vertical" : "horizontal",
        },
      ];
    }

    const min = finiteNumber(widget.min, 0);
    const maxCandidate = finiteNumber(widget.max, 255);
    const max = maxCandidate > min ? maxCandidate : min + 1;
    const stepCandidate = finiteNumber(widget.step, 1);
    const step = stepCandidate > 0 ? stepCandidate : 1;
    const value = Math.min(max, Math.max(min, finiteNumber(widget.value, min)));
    return [
      {
        ...base,
        type,
        template: stringValue(widget.template, "PWM={value}"),
        min,
        max,
        step,
        value,
        sendMode: widget.sendMode === "continuous" ? "continuous" : "release",
      },
    ];
  });

  if (source.widgets.length > 0 && widgets.length === 0) throw new Error("配置中没有可用的控制面板控件");

  return {
    version: 4,
    name: stringValue(source.name, DEFAULT_PANEL.name) || DEFAULT_PANEL.name,
    widgets,
  };
}

export function loadSerialControlPanel(): SerialControlPanelConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseSerialControlPanel(JSON.parse(saved)) : { ...DEFAULT_PANEL };
  } catch {
    return { ...DEFAULT_PANEL };
  }
}

export function saveSerialControlPanel(panel: SerialControlPanelConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panel));
  } catch {
    // 本地存储不可用时仍允许当前会话继续使用。
  }
}

export function renderSerialControlCommand(template: string, value: string | number) {
  return template.split("{value}").join(String(value));
}

export function renderSerialJoystickCommand(template: string, x: number, y: number) {
  return template.split("{x}").join(String(x)).split("{y}").join(String(y));
}

export function parseSerialCommandSequence(commands: string) {
  return commands.split(/\r\n?|\n/).filter((command) => command.trim().length > 0);
}

function normalizeAngle(angle: number) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

export function applySerialImuOffsets(
  raw: { roll: number; pitch: number; yaw: number },
  offsets: Pick<SerialImu3dWidget, "rollOffset" | "pitchOffset" | "yawOffset">
) {
  return {
    roll: normalizeAngle(raw.roll - offsets.rollOffset),
    pitch: normalizeAngle(raw.pitch - offsets.pitchOffset),
    yaw: normalizeAngle(raw.yaw - offsets.yawOffset),
  };
}

export function resolveSerialImuAngles(
  widget: Pick<
    SerialImu3dWidget,
    "rollChannel" | "pitchChannel" | "yawChannel" | "angleUnit" | "rollOffset" | "pitchOffset" | "yawOffset"
  >,
  values: Record<string, number>
) {
  const source = [values[widget.rollChannel], values[widget.pitchChannel], values[widget.yawChannel]];
  if (!source.every(Number.isFinite)) return null;
  const factor = widget.angleUnit === "rad" ? 180 / Math.PI : 1;
  const raw = { roll: source[0] * factor, pitch: source[1] * factor, yaw: source[2] * factor };
  return { raw, display: applySerialImuOffsets(raw, widget) };
}

/**
 * 输入姿态（欧拉角 / 六轴融合 / 四元数）合成叠加旋转后的欧拉角，归零前。
 * missing 列出当前帧缺失的通道 key，用于提示绑定错误。
 */
export function resolveSerialImuPose(
  widget: SerialImu3dWidget,
  values: Record<string, number>,
  fused: ImuOrientation | null
): { raw: ImuOrientation | null; missing: string[] } {
  const missing: string[] = [];
  let euler: ImuOrientation | null = null;
  let quat = null;
  if (widget.sourceMode === "quat") {
    quat = readQuaternionInput(widget, values, missing);
  } else if (widget.sourceMode === "imu6") {
    euler = fused;
  } else {
    euler = resolveSerialImuAngles(widget, values)?.raw ?? null;
    for (const key of [widget.rollChannel, widget.pitchChannel, widget.yawChannel]) {
      if (!Number.isFinite(values[key])) missing.push(key || "（未绑定）");
    }
  }
  if (!widget.overlayEnabled) return { raw: quat ? eulerFromQuaternion(quat) : euler, missing };

  const overlay = resolveOverlayQuaternion(widget, values, missing);
  const input = quat ?? (euler && quaternionFromEuler(euler));
  if (!input || !overlay) return { raw: null, missing };
  return { raw: eulerFromQuaternion(composeOverlay(input, overlay, widget.overlayOrder)), missing };
}

function quantize(value: number, min: number, max: number, step: number) {
  const quantized = min + Math.round((value - min) / step) * step;
  return Number(Math.min(max, Math.max(min, quantized)).toFixed(10));
}

export function joystickPointFromRatio(
  widget: Pick<SerialJoystickWidget, "xMin" | "xMax" | "yMin" | "yMax" | "step">,
  xRatio: number,
  yRatio: number
) {
  const x = widget.xMin + Math.min(1, Math.max(0, xRatio)) * (widget.xMax - widget.xMin);
  const y = widget.yMax - Math.min(1, Math.max(0, yRatio)) * (widget.yMax - widget.yMin);
  return {
    x: quantize(x, widget.xMin, widget.xMax, widget.step),
    y: quantize(y, widget.yMin, widget.yMax, widget.step),
  };
}
