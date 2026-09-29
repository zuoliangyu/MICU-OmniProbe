// Serial port types for frontend

import type { RttLine } from "./types";

/**
 * Serial port information
 */
export interface SerialPortInfo {
  name: string;
  port_type: string;
  description: string | null;
  manufacturer: string | null;
  serial_number: string | null;
}

/**
 * Serial connection configuration - Local serial port
 */
export interface LocalSerialConfig {
  type: "local";
  port: string;
  baud_rate: number;
  data_bits?: 5 | 6 | 7 | 8;
  stop_bits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  flow_control?: "none" | "hardware" | "software";
  /** 打开串口后是否拉高 DTR（默认关） */
  dtr?: boolean;
  /** 打开串口后是否拉高 RTS（默认关；硬件流控时由驱动接管） */
  rts?: boolean;
  reconnect?: boolean;
}

/**
 * Serial connection configuration - TCP serial server
 */
export interface TcpSerialConfig {
  type: "tcp";
  host: string;
  port: number;
  reconnect?: boolean;
}

/** 双向 UDP 数据接口配置 */
export interface UdpSerialConfig {
  type: "udp";
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
}

export type SimulationPreset = "waveform" | "filter-demo" | "xy" | "imu3" | "imu6";
export type SimulationWaveform = "sine" | "square" | "triangle" | "sawtooth" | "noise" | "constant";
export type SimulationXyPattern = "circle" | "lissajous";

/** 前端模拟数据源配置，不会传给后端连接命令。 */
export interface SimulationSerialConfig {
  preset: SimulationPreset;
  sampleRateHz: number;
  frequencyHz: number;
  amplitude: number;
  offset: number;
  noise: number;
  channelCount: number;
  waveform: SimulationWaveform;
  xyPattern: SimulationXyPattern;
}

/**
 * Serial connection configuration (union type)
 */
export type SerialConfig = LocalSerialConfig | TcpSerialConfig | UdpSerialConfig;

/**
 * Serial connection statistics
 */
export interface SerialStats {
  bytes_received: number;
  bytes_sent: number;
}

/**
 * Serial status from backend
 */
/**
 * Serial data event from backend
 */
export interface SerialDataChunk {
  data: number[];
  timestamp: number;
}

export interface SerialDataEvent {
  chunks: SerialDataChunk[];
  direction: "rx" | "tx";
}

/**
 * Serial status event from backend
 */
export interface SerialStatusEvent {
  connected: boolean;
  running: boolean;
  error: string | null;
}

export interface AiBridgeStatus {
  running: boolean;
  port: number;
  allowWrite: boolean;
  clients: number;
  droppedBatches: number;
}

export interface AiTelemetryChannel {
  key: string;
  name: string;
  unit: string | null;
}

export interface AiTelemetrySample {
  timestamp: number;
  values: Record<string, number>;
}

export interface AiTelemetryBatch {
  source: "serial";
  sampleRateHz: number;
  channels: AiTelemetryChannel[];
  samples: AiTelemetrySample[];
}

export interface AiTextLine {
  timestamp: number;
  direction: "rx" | "tx";
  text: string;
  truncated: boolean;
}

export interface AiTextBatch {
  source: "serial";
  lines: AiTextLine[];
}

export const DEFAULT_AI_BRIDGE_STATUS: AiBridgeStatus = {
  running: false,
  port: 0,
  allowWrite: false,
  clients: 0,
  droppedBatches: 0,
};

/**
 * Serial line (extends RttLine for reuse)
 */
export interface SerialLine extends Omit<RttLine, "channel"> {
  direction: "rx" | "tx";
}

/** 日志视图可显示的行：RTT 行没有方向，按 rx 处理，无需逐行拷贝补字段。 */
export type ViewerLine = Omit<SerialLine, "direction"> & { direction?: SerialLine["direction"] };

export interface SerialTerminalLine {
  id: number;
  text: string;
}

/**
 * Common baud rates
 */
export const COMMON_BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 128000, 230400, 256000, 460800, 500000,
  576000, 921600, 1000000, 1152000, 1500000, 2000000, 2500000, 3000000, 3500000, 4000000,
] as const;

/**
 * Data source type for display
 */
export type DataSourceType = "local" | "tcp" | "udp" | "simulation";

export type SerialTextViewMode = "log" | "terminal";

/**
 * Line ending options
 */
export type LineEnding = "none" | "lf" | "crlf" | "cr";

/**
 * Encoding options
 */
export type Encoding = "utf-8" | "ascii" | "gbk";

export type SerialFileTransferProtocol = "raw" | "xmodem" | "xmodem-1k" | "ymodem" | "zmodem";

export interface SerialFileTransferOptions {
  path: string;
  protocol: SerialFileTransferProtocol;
  rawChunkSize: number;
  rawIntervalMs: number;
  simulation: boolean;
}

export interface SerialFileTransferProgress {
  phase: "waiting" | "sending" | "finishing" | "completed";
  bytesSent: number;
  totalBytes: number;
  elapsedMs: number;
}

export interface SerialFileTransferResult {
  bytesSent: number;
  elapsedMs: number;
}

/**
 * 接收分帧模式：决定如何把收到的字节切成一行显示
 * - auto: 按 \n 或 \r\n 断行（兼容两者）
 * - lf / crlf / cr: 严格按对应换行符断行
 * - timeout: 不按分隔符，静默 idleMs 后认为一帧结束
 * - custom: 按自定义分隔符断行（文本或 HEX）
 */
export type RxFramingMode = "auto" | "lf" | "crlf" | "cr" | "timeout" | "custom";

export interface RxFramingSettings {
  /** 接收文本编码；HEX 显示不受此项影响 */
  encoding: Encoding;
  mode: RxFramingMode;
  /** 超时分帧的空闲毫秒数（timeout 模式生效） */
  idleMs: number;
  /** 自定义分隔符（custom 模式生效） */
  customDelimiter: string;
  /** 自定义分隔符是否按 HEX 解析（如 "0D 0A"） */
  customIsHex: boolean;
}

export const DEFAULT_RX_FRAMING: RxFramingSettings = {
  encoding: "utf-8",
  mode: "auto",
  idleMs: 50,
  customDelimiter: "",
  customIsHex: false,
};

export interface SerialTerminalSettings {
  localEcho: boolean;
  interceptShortcuts: boolean;
  /** 行编辑模式：本地累积输入并由 ↑↓ 翻历史，回车后整行发送；关闭则按字符直通发送。 */
  lineMode: boolean;
}
