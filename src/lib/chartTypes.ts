/**
 * RTT 图表相关类型定义
 */

import type { TelemetryChannelDescriptor, TelemetrySample } from "./telemetry";
import {
  DEFAULT_BINARY_PROTOCOL_CONFIG,
  sanitizeBinaryProtocolConfig,
  type BinaryProtocolConfig,
} from "./binaryProtocol.ts";

/**
 * 图表数据点
 */
export type ChartDataPoint = TelemetrySample;

/**
 * 通道：解析字段 + 显示样式 合一
 *
 * - key 是逻辑键（JSON key / KV key / 正则命名组 / 分隔符列名），同时也是 ChartDataPoint.values 里的键
 * - sourceIndex 在 delimiter / justfloat / Modbus 模式下表示读取第几个解析值
 * - role 决定该通道是 Y 轴数据还是 X 轴（仅 xy-scatter 模式有意义），最多一个 "x"
 */
export interface Channel extends TelemetryChannelDescriptor {
  color: string;
  visible: boolean;
  role?: "x" | "y";
  /** 仅 SLCAN 模式使用的 CAN payload 信号来源。 */
  can?: CanSignalSource;
}

export type CanByteOrder = "little" | "big";

export interface CanSignalSource {
  frameId: number;
  extended: boolean;
  /** 未设置时同时匹配经典 CAN 与 CAN FD。 */
  fd?: boolean;
  startBit: number;
  bitLength: number;
  byteOrder: CanByteOrder;
  signed: boolean;
  factor: number;
  offset: number;
}

export interface CanBusConfig {
  bitrate: number;
  dataBitrate: number;
  loadWindowMs: number;
  alarmThreshold: number;
  autoInitialize: boolean;
  timestamps: boolean;
  /** 留空时生成标准 Lawicel C/S/Z/O 命令；否则每行作为一条适配器命令。 */
  initCommands: string;
}

/**
 * 旧版本兼容别名。Channel 结构上兼容 ChartSeries 的所有字段，
 * 因此现有渲染代码（SignalPlotCanvas 等）可以直接消费 Channel[]。
 */
export type ChartSeries = Channel;

/** 解析模式。第三方文本解析器使用 plugin: 前缀，避免与内置模式冲突。 */
export type ModbusParseMode = "modbus-rtu" | "modbus-ascii" | "modbus-tcp";
export type BuiltInParseMode =
  "regex" | "delimiter" | "json" | "kv" | "binary" | "justfloat" | "slcan" | ModbusParseMode | "auto";

/**
 * 需要原始字节流的内置解析模式。文本行已经过分帧和解码，还原不回字节，
 * 因此只能提供文本的数据源必须排除这些模式。
 *
 * 这里没有直接查解析器注册表，是因为 parseChartData.ts 依赖本文件，
 * 反向 import 会形成循环。两处定义可能漂移，故由
 * scripts/check-bytes-parser-registry.mjs 断言二者一致。
 */
const MODBUS_PARSE_MODES = new Set<string>(["modbus-rtu", "modbus-ascii", "modbus-tcp"]);
const BYTES_PARSE_MODES = new Set<string>(["binary", "justfloat", "slcan", ...MODBUS_PARSE_MODES]);

export function isModbusParseMode(value: string): value is ModbusParseMode {
  return MODBUS_PARSE_MODES.has(value);
}

export function isBytesParseMode(value: string): boolean {
  return BYTES_PARSE_MODES.has(value);
}
export type PluginParseMode = `plugin:${string}`;
export type ParseMode = BuiltInParseMode | PluginParseMode;

export function isPluginParseMode(value: unknown): value is PluginParseMode {
  return typeof value === "string" && /^plugin:[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}

/**
 * 图表类型
 */
export type ChartType = "waveform" | "line" | "bar" | "scatter" | "xy-scatter";

/**
 * 波形显示域
 */
export type SignalDomain = "time" | "fft";

/** 时域波形相邻采样点的连接方式 */
export type WaveformInterpolation = "linear" | "smooth";

/** 时域波形的实时滤波执行方式 */
export type DataFilterKind = "fir" | "sos" | "median" | "cascade";

export type ParametricFilterType = "lowpass" | "highpass" | "bandpass";

export interface ParametricFilterStage {
  id: string;
  type: ParametricFilterType;
  /** false 时保留参数但不参与级联 */
  enabled: boolean;
  /** 低/高通为截止频率，带通为中心频率 */
  frequencyHz: number;
  /** 品质因数；带通的近似带宽为 frequencyHz / q */
  q: number;
}

export interface DataFilterConfig {
  enabled: boolean;
  kind: DataFilterKind;
  /** 设计或计算滤波参数时使用的采样率 */
  sampleRateHz: number;
  firCoefficients: number[];
  /** 每行格式：[b0, b1, b2, a0, a1, a2] */
  sosSections: number[][];
  /** MATLAB 导出的 g 或 ScaleValues；运行时使用其乘积 */
  scaleValues: number[];
  medianWindowSize: number;
  parametricStages: ParametricFilterStage[];
  showOriginal: boolean;
}

export const DEFAULT_DATA_FILTER_CONFIG: DataFilterConfig = {
  enabled: false,
  kind: "sos",
  sampleRateHz: 0,
  firCoefficients: [],
  sosSections: [],
  scaleValues: [1],
  medianWindowSize: 3,
  parametricStages: [],
  showOriginal: true,
};

/** 结构化数据解析配置。启用后不依赖当前展示视图持续解析。 */
export interface DataParseConfig {
  enabled: boolean;
  /** 解析模式 */
  parseMode: ParseMode;
  /** 文本数据帧前缀；非空时只解析并剥离匹配此前缀的行 */
  framePrefix: string;

  // 正则模式
  /** 正则表达式 */
  regexPattern: string;
  /** 正则标志，如 "g", "gi" */
  regexFlags?: string;

  // 分隔符模式
  /** 分隔符，如 ",", "\t", " " */
  delimiter: string;

  /** Modbus 只读主站配置。字段名为兼容旧版持久化数据而保留。 */
  modbusRtu: ModbusRtuConfig;

  /** SLCAN 总线负载统计配置；信号映射保存在 channels[].can。 */
  canBus: CanBusConfig;

  /** 通用二进制协议设计器配置。 */
  binaryProtocol: BinaryProtocolConfig;
}

export type ModbusFunctionCode = 3 | 4;
export type ModbusDataType = "uint16" | "int16" | "uint32" | "int32" | "float32";
export type ModbusByteOrder = "big" | "little";
export type ModbusWordOrder = "big" | "little";

export interface ModbusRtuConfig {
  autoPoll: boolean;
  slaveId: number;
  functionCode: ModbusFunctionCode;
  startAddress: number;
  registerCount: number;
  pollIntervalMs: number;
  dataType: ModbusDataType;
  byteOrder: ModbusByteOrder;
  wordOrder: ModbusWordOrder;
  scale: number;
  offset: number;
}

// ponytail: 一个读取块共用一种数值布局；设备需要混合类型时再增加逐字段映射。

export const DEFAULT_MODBUS_RTU_CONFIG: ModbusRtuConfig = {
  autoPoll: true,
  slaveId: 1,
  functionCode: 3,
  startAddress: 0,
  registerCount: 1,
  pollIntervalMs: 200,
  dataType: "uint16",
  byteOrder: "big",
  wordOrder: "big",
  scale: 1,
  offset: 0,
};

export const DEFAULT_CAN_BUS_CONFIG: CanBusConfig = {
  bitrate: 500_000,
  dataBitrate: 2_000_000,
  loadWindowMs: 1_000,
  alarmThreshold: 0.8,
  autoInitialize: false,
  timestamps: true,
  initCommands: "",
};

export const TRIGGER_CONDITIONS = ["rising", "falling", "above", "below"] as const;
export type TriggerCondition = (typeof TRIGGER_CONDITIONS)[number];

export const TRIGGER_MODES = ["single", "normal"] as const;
/** single：触发一次后停住等用户手动重新武装；normal：捕获完自动继续等下一次 */
export type TriggerMode = (typeof TRIGGER_MODES)[number];

export const TRIGGER_VIEWS = ["window", "full"] as const;
/**
 * 捕获完成后如何呈现：
 * - window：只显示触发窗口，聚焦事件本身（示波器的心智模型）
 * - full：仍显示整个缓冲区，在触发点画标记，保留上下文便于看趋势
 */
export type TriggerView = (typeof TRIGGER_VIEWS)[number];

export interface TriggerConfig {
  enabled: boolean;
  /** 监视哪一路通道的 key */
  channelKey: string;
  condition: TriggerCondition;
  /** 触发电平 */
  level: number;
  /** 触发点之前保留多少个样本 */
  preSamples: number;
  /** 触发点之后再采多少个样本 */
  postSamples: number;
  mode: TriggerMode;
  /** 捕获完成后的呈现方式 */
  view: TriggerView;
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  enabled: false,
  channelKey: "",
  condition: "rising",
  level: 0,
  preSamples: 200,
  postSamples: 200,
  mode: "single",
  view: "window",
};

export interface DataProcessingConfig {
  /** 图表、FFT、统计和控制面板共享的数据滤波配置 */
  dataFilter: DataFilterConfig;
  /** 触发捕获配置 */
  trigger: TriggerConfig;
}

export interface ChartViewConfig {
  /** 图表类型 */
  chartType: ChartType;
  /** 渲染时最多显示多少个点，0 表示自动 */
  visiblePointLimit: number;
  /** 更新间隔（毫秒） */
  updateInterval: number;

  /** FFT 窗口大小 */
  fftWindowSize: number;
  /** 波形示波器的默认显示域 */
  signalDomain: SignalDomain;
  /** 时域波形连接方式 */
  waveformInterpolation: WaveformInterpolation;

  /** 是否显示网格 */
  showGrid: boolean;
  /** 是否显示图例 */
  showLegend: boolean;
  /** 是否显示工具提示 */
  showTooltip: boolean;
  /** 是否启用动画 */
  animationEnabled: boolean;
}

export interface TelemetryConfig extends DataParseConfig, DataProcessingConfig {
  /** 解析字段与内部通道描述；展示样式由 Channel 的扩展字段提供。 */
  channels: Channel[];
  /** 内存中保留的最大原始采样数。 */
  maxDataPoints: number;
  /** 采样率（Hz，0 表示自动估算）。 */
  sampleRateHz: number;
}

/** 兼容现有持久化结构的完整图表配置。 */
export interface ChartConfig extends TelemetryConfig, ChartViewConfig {}

/**
 * 视图模式
 */
export type ViewMode = "text" | "chart" | "split";

/**
 * 分屏方向
 * vertical: 上下分屏
 * horizontal: 左右分屏
 */
export type SplitOrientation = "vertical" | "horizontal";

/**
 * 默认图表配置
 */
/**
 * 缓冲点数上限。每批数据都要对整个缓冲做 concat + slice、统计与坐标范围计算，
 * 成本随点数线性增长；不设上限时误填百万级数值会同时拖垮帧率和内存。
 */
export const MAX_CHART_DATA_POINTS = 200_000;
export const MIN_CHART_DATA_POINTS = 100;

export const DEFAULT_CHART_CONFIG: ChartConfig = {
  enabled: false,
  parseMode: "auto",
  framePrefix: "",

  regexPattern: "",
  regexFlags: "",

  delimiter: ",",
  modbusRtu: DEFAULT_MODBUS_RTU_CONFIG,
  canBus: DEFAULT_CAN_BUS_CONFIG,
  binaryProtocol: DEFAULT_BINARY_PROTOCOL_CONFIG,

  channels: [],

  chartType: "waveform",
  maxDataPoints: 4000,
  visiblePointLimit: 600,
  updateInterval: 33,
  fftWindowSize: 1024,
  sampleRateHz: 0,
  signalDomain: "time",
  waveformInterpolation: "linear",
  dataFilter: DEFAULT_DATA_FILTER_CONFIG,
  trigger: DEFAULT_TRIGGER_CONFIG,

  showGrid: true,
  showLegend: true,
  showTooltip: true,
  animationEnabled: true,
};

export function isSignalWorkspaceActive(viewMode: ViewMode, config: ChartConfig, domain: SignalDomain): boolean {
  return viewMode !== "text" && config.enabled && config.chartType === "waveform" && config.signalDomain === domain;
}

export function getSignalWorkspaceTransition(
  viewMode: ViewMode,
  config: ChartConfig,
  domain: SignalDomain
): { viewMode: ViewMode; chartConfig: ChartConfig } {
  if (isSignalWorkspaceActive(viewMode, config, domain)) {
    return { viewMode: "text", chartConfig: config };
  }

  return {
    viewMode: viewMode === "text" ? "split" : viewMode,
    chartConfig: {
      ...config,
      enabled: true,
      chartType: "waveform",
      signalDomain: domain,
    },
  };
}

/**
 * 预设颜色列表（用于自动分配通道颜色）
 */
export const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#6366f1", // indigo
];

/**
 * 取所有可见的 Y 轴通道
 */
export function getVisibleYChannels(config: ChartConfig): Channel[] {
  return config.channels.filter((c) => (c.role ?? "y") === "y" && c.visible);
}

/**
 * 取 X 轴通道（仅 xy-scatter 模式有意义）
 */
export function getXChannel(config: ChartConfig): Channel | undefined {
  return config.channels.find((c) => c.role === "x");
}

/**
 * 把任意外部传入的对象（含旧版 series/fields/jsonKeys/kvKeys/xAxisField/xxxEnabled）
 * 折叠成新版 ChartConfig 的 channels 模型。
 *
 * 幂等：传入新版 shape（已含 channels 数组）时仅做字段补齐。
 * allowBytesParsers=false 用于只能提供文本行的数据源，会把持久化下来的
 * 字节流解析模式回退成默认值，避免选中一个该源根本喂不了数据的解析器。
 */
export function migrateChartConfig(raw: unknown, allowBytesParsers = true): ChartConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CHART_CONFIG };
  }

  const source = raw as Record<string, unknown>;

  const enabled = typeof source.enabled === "boolean" ? source.enabled : DEFAULT_CHART_CONFIG.enabled;
  const parsedMode = isParseMode(source.parseMode) ? source.parseMode : DEFAULT_CHART_CONFIG.parseMode;
  const parseMode = !allowBytesParsers && isBytesParseMode(parsedMode) ? DEFAULT_CHART_CONFIG.parseMode : parsedMode;
  const chartType = isChartType(source.chartType) ? source.chartType : DEFAULT_CHART_CONFIG.chartType;
  const signalDomain = source.signalDomain === "fft" ? "fft" : DEFAULT_CHART_CONFIG.signalDomain;

  // 优先使用新版 channels；否则从旧字段拼回
  let channels: Channel[];
  if (Array.isArray(source.channels)) {
    channels = sanitizeChannels(source.channels);
  } else {
    channels = buildChannelsFromLegacy(source);
  }

  return {
    enabled,
    parseMode,
    framePrefix: typeof source.framePrefix === "string" ? source.framePrefix : "",
    regexPattern: typeof source.regexPattern === "string" ? source.regexPattern : "",
    regexFlags: typeof source.regexFlags === "string" ? source.regexFlags : "",
    delimiter:
      typeof source.delimiter === "string" && source.delimiter.length > 0
        ? source.delimiter
        : DEFAULT_CHART_CONFIG.delimiter,
    modbusRtu: sanitizeModbusRtu(source.modbusRtu, parseMode),
    canBus: sanitizeCanBus(source.canBus),
    binaryProtocol: sanitizeBinaryProtocolConfig(source.binaryProtocol),
    channels,
    chartType,
    maxDataPoints: clampInt(
      source.maxDataPoints,
      MIN_CHART_DATA_POINTS,
      MAX_CHART_DATA_POINTS,
      DEFAULT_CHART_CONFIG.maxDataPoints
    ),
    visiblePointLimit: clampInt(
      source.visiblePointLimit,
      0,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_CHART_CONFIG.visiblePointLimit
    ),
    updateInterval: clampInt(source.updateInterval, 16, Number.MAX_SAFE_INTEGER, DEFAULT_CHART_CONFIG.updateInterval),
    fftWindowSize: clampInt(source.fftWindowSize, 32, 4096, DEFAULT_CHART_CONFIG.fftWindowSize),
    sampleRateHz: clampNumber(source.sampleRateHz, 0, Number.MAX_SAFE_INTEGER, 0),
    signalDomain,
    waveformInterpolation: source.waveformInterpolation === "smooth" ? "smooth" : "linear",
    dataFilter: sanitizeDataFilter(source.dataFilter),
    trigger: sanitizeTrigger(source.trigger),
    showGrid: source.showGrid !== false,
    showLegend: source.showLegend !== false,
    showTooltip: source.showTooltip !== false,
    animationEnabled: source.animationEnabled !== false,
  };
}

/** 触发配置来自持久化存储，逐字段收敛到合法范围，避免旧版本或手改的配置让状态机跑飞。 */
function sanitizeTrigger(raw: unknown): TriggerConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TRIGGER_CONFIG };
  const source = raw as Record<string, unknown>;
  const condition = TRIGGER_CONDITIONS.find((item) => item === source.condition) ?? DEFAULT_TRIGGER_CONFIG.condition;
  const mode = TRIGGER_MODES.find((item) => item === source.mode) ?? DEFAULT_TRIGGER_CONFIG.mode;
  const view = TRIGGER_VIEWS.find((item) => item === source.view) ?? DEFAULT_TRIGGER_CONFIG.view;
  return {
    enabled: source.enabled === true,
    channelKey: typeof source.channelKey === "string" ? source.channelKey : "",
    condition,
    mode,
    view,
    level: clampNumber(source.level, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, DEFAULT_TRIGGER_CONFIG.level),
    // 前后置样本数至少各 1：都为 0 会让窗口为空，捕获等于没捕到
    preSamples: clampInt(source.preSamples, 1, 100000, DEFAULT_TRIGGER_CONFIG.preSamples),
    postSamples: clampInt(source.postSamples, 1, 100000, DEFAULT_TRIGGER_CONFIG.postSamples),
  };
}

function sanitizeDataFilter(raw: unknown): DataFilterConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DATA_FILTER_CONFIG };
  const source = raw as Record<string, unknown>;
  const kind: DataFilterKind =
    source.kind === "fir" || source.kind === "median" || source.kind === "cascade" ? source.kind : "sos";
  const firCoefficients = sanitizeNumberArray(source.firCoefficients, 2048);
  const sosSections = Array.isArray(source.sosSections)
    ? source.sosSections
        .slice(0, 128)
        .map((row) => sanitizeNumberArray(row, 6))
        .filter((row) => row.length === 6 && row[3] !== 0)
    : [];
  const scaleValues = sanitizeNumberArray(source.scaleValues, 129);
  let medianWindowSize = clampInt(source.medianWindowSize, 3, 255, 3);
  if (medianWindowSize % 2 === 0) medianWindowSize += medianWindowSize < 255 ? 1 : -1;

  return {
    enabled: source.enabled === true,
    kind,
    sampleRateHz: clampNumber(source.sampleRateHz, 0, Number.MAX_SAFE_INTEGER, 0),
    firCoefficients,
    sosSections,
    scaleValues: scaleValues.length > 0 ? scaleValues : [1],
    medianWindowSize,
    parametricStages: sanitizeParametricStages(source.parametricStages),
    showOriginal: source.showOriginal !== false,
  };
}

function sanitizeParametricStages(raw: unknown): ParametricFilterStage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const type: ParametricFilterType =
      source.type === "highpass" || source.type === "bandpass" ? source.type : "lowpass";
    return [
      {
        id: typeof source.id === "string" && source.id ? source.id : `stage-${index + 1}`,
        type,
        enabled: source.enabled !== false,
        frequencyHz: clampNumber(source.frequencyHz, 0, Number.MAX_SAFE_INTEGER, 10),
        q: clampNumber(source.q, 0.001, 1000, Math.SQRT1_2),
      },
    ];
  });
}

function sanitizeNumberArray(raw: unknown, maxLength: number): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, maxLength)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function sanitizeChannels(raw: unknown[]): Channel[] {
  const out: Channel[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== "string" || !e.key) return;
    out.push({
      key: e.key,
      sourceIndex: typeof e.sourceIndex === "number" && e.sourceIndex >= 0 ? Math.floor(e.sourceIndex) : undefined,
      name: typeof e.name === "string" && e.name ? e.name : e.key,
      unit: typeof e.unit === "string" ? e.unit : undefined,
      color: typeof e.color === "string" && e.color ? e.color : PRESET_COLORS[index % PRESET_COLORS.length],
      visible: e.visible !== false,
      role: e.role === "x" ? "x" : "y",
      can: sanitizeCanSignalSource(e.can),
    });
  });
  // 至多一个 x
  let xSeen = false;
  return out.map((c) => {
    if (c.role === "x") {
      if (xSeen) return { ...c, role: "y" as const };
      xSeen = true;
    }
    return c;
  });
}

function sanitizeCanSignalSource(raw: unknown): CanSignalSource | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const extended = source.extended === true;
  return {
    frameId: clampInt(source.frameId, 0, extended ? 0x1fffffff : 0x7ff, 0),
    extended,
    fd: typeof source.fd === "boolean" ? source.fd : undefined,
    startBit: clampInt(source.startBit, 0, 511, 0),
    bitLength: clampInt(source.bitLength, 1, 64, 8),
    byteOrder: source.byteOrder === "big" ? "big" : "little",
    signed: source.signed === true,
    factor: clampNumber(source.factor, -Number.MAX_VALUE, Number.MAX_VALUE, 1),
    offset: clampNumber(source.offset, -Number.MAX_VALUE, Number.MAX_VALUE, 0),
  };
}

function buildChannelsFromLegacy(source: Record<string, unknown>): Channel[] {
  const oldSeries = Array.isArray(source.series) ? (source.series as Array<Record<string, unknown>>) : [];
  const oldFields = Array.isArray(source.fields) ? (source.fields as Array<Record<string, unknown>>) : [];
  const oldJsonKeys = Array.isArray(source.jsonKeys) ? (source.jsonKeys as unknown[]) : [];
  const oldKvKeys = Array.isArray(source.kvKeys) ? (source.kvKeys as unknown[]) : [];
  const xAxisField = typeof source.xAxisField === "string" ? source.xAxisField : "";
  const parseMode = typeof source.parseMode === "string" ? source.parseMode : "auto";

  const seriesByKey = new Map<string, Record<string, unknown>>();
  for (const s of oldSeries) {
    const k = typeof s?.key === "string" ? s.key : "";
    if (k) seriesByKey.set(k, s);
  }

  const channels: Channel[] = [];
  const used = new Set<string>();

  const pushChannel = (input: Partial<Channel> & { key: string; sourceIndex?: number }) => {
    if (!input.key || used.has(input.key)) return;
    used.add(input.key);
    const existing = seriesByKey.get(input.key);
    channels.push({
      key: input.key,
      sourceIndex: input.sourceIndex,
      name: typeof existing?.name === "string" && existing.name ? existing.name : (input.name ?? input.key),
      unit: typeof existing?.unit === "string" ? existing.unit : input.unit,
      color:
        typeof existing?.color === "string" && existing.color
          ? existing.color
          : (input.color ?? PRESET_COLORS[channels.length % PRESET_COLORS.length]),
      visible: existing ? existing.visible !== false : input.visible !== false,
      role: input.key === xAxisField ? "x" : "y",
    });
  };

  // 分隔符模式：fields 是真相
  if (parseMode === "delimiter" && oldFields.length > 0) {
    oldFields.forEach((field, idx) => {
      if (!field || field.enabled === false) return;
      const name = typeof field.name === "string" ? field.name : `field${idx + 1}`;
      const sourceIndex = typeof field.index === "number" ? field.index : idx;
      pushChannel({ key: name, sourceIndex });
    });
  } else {
    // 其他模式：series 优先；其次 jsonKeys / kvKeys
    for (const s of oldSeries) {
      const k = typeof s?.key === "string" ? s.key : "";
      if (k) pushChannel({ key: k });
    }
    for (const k of oldJsonKeys) {
      if (typeof k === "string" && k) pushChannel({ key: k });
    }
    for (const k of oldKvKeys) {
      if (typeof k === "string" && k) pushChannel({ key: k });
    }
    // 分隔符 fields 也补一下（自动模式下可能两边都有）
    oldFields.forEach((field, idx) => {
      if (!field || field.enabled === false) return;
      const name = typeof field.name === "string" ? field.name : `field${idx + 1}`;
      const sourceIndex = typeof field.index === "number" ? field.index : idx;
      pushChannel({ key: name, sourceIndex });
    });
  }

  // X 轴字段如果还没出现，补一条
  if (xAxisField && !used.has(xAxisField)) {
    used.add(xAxisField);
    channels.push({
      key: xAxisField,
      name: xAxisField,
      color: PRESET_COLORS[channels.length % PRESET_COLORS.length],
      visible: true,
      role: "x",
    });
  }

  return channels;
}

function isParseMode(value: unknown): value is ParseMode {
  return (
    value === "regex" ||
    value === "delimiter" ||
    value === "json" ||
    value === "kv" ||
    value === "binary" ||
    value === "justfloat" ||
    value === "slcan" ||
    (typeof value === "string" && isModbusParseMode(value)) ||
    value === "auto" ||
    isPluginParseMode(value)
  );
}

function sanitizeCanBus(raw: unknown): CanBusConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAN_BUS_CONFIG };
  const source = raw as Record<string, unknown>;
  return {
    bitrate: clampInt(source.bitrate, 1_000, 10_000_000, DEFAULT_CAN_BUS_CONFIG.bitrate),
    dataBitrate: clampInt(source.dataBitrate, 1_000, 20_000_000, DEFAULT_CAN_BUS_CONFIG.dataBitrate),
    loadWindowMs: clampInt(source.loadWindowMs, 100, 5_000, DEFAULT_CAN_BUS_CONFIG.loadWindowMs),
    alarmThreshold: clampNumber(source.alarmThreshold, 0.1, 1.5, DEFAULT_CAN_BUS_CONFIG.alarmThreshold),
    autoInitialize: source.autoInitialize === true,
    timestamps: source.timestamps !== false,
    initCommands: typeof source.initCommands === "string" ? source.initCommands.slice(0, 2_000) : "",
  };
}

function sanitizeModbusRtu(raw: unknown, parseMode: ParseMode): ModbusRtuConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODBUS_RTU_CONFIG };
  const source = raw as Record<string, unknown>;
  const dataType: ModbusDataType =
    source.dataType === "int16" ||
    source.dataType === "uint32" ||
    source.dataType === "int32" ||
    source.dataType === "float32"
      ? source.dataType
      : "uint16";
  const valueWidth = dataType === "uint16" || dataType === "int16" ? 1 : 2;
  const startAddress = clampInt(source.startAddress, 0, 65536 - valueWidth, DEFAULT_MODBUS_RTU_CONFIG.startAddress);
  const maxRegisters = Math.min(125, 65536 - startAddress);
  let registerCount = clampInt(source.registerCount, valueWidth, maxRegisters, valueWidth);
  registerCount -= registerCount % valueWidth;

  return {
    autoPoll: source.autoPoll !== false,
    slaveId: clampInt(
      source.slaveId,
      parseMode === "modbus-tcp" ? 0 : 1,
      parseMode === "modbus-tcp" ? 255 : 247,
      DEFAULT_MODBUS_RTU_CONFIG.slaveId
    ),
    functionCode: source.functionCode === 4 ? 4 : 3,
    startAddress,
    registerCount,
    pollIntervalMs: clampInt(source.pollIntervalMs, 20, 60000, DEFAULT_MODBUS_RTU_CONFIG.pollIntervalMs),
    dataType,
    byteOrder: source.byteOrder === "little" ? "little" : "big",
    wordOrder: source.wordOrder === "little" ? "little" : "big",
    scale: clampNumber(source.scale, -Number.MAX_VALUE, Number.MAX_VALUE, 1),
    offset: clampNumber(source.offset, -Number.MAX_VALUE, Number.MAX_VALUE, 0),
  };
}

function isChartType(value: unknown): value is ChartType {
  return value === "waveform" || value === "line" || value === "bar" || value === "scatter" || value === "xy-scatter";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
