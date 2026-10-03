import { createTelemetryChartSlice, type TelemetryChartState } from "./telemetryChartSlice";
import type { ViewMode, SplitOrientation } from "@/lib/chartTypes";
import { create } from "zustand";
import type { RxFramingSettings } from "@/lib/serialTypes";
import { DEFAULT_RX_FRAMING } from "@/lib/serialTypes";
import type { RttChannel, RttConfig, RttLine, RttPhase, RttScanMode } from "@/lib/types";
import type { Encoding, LineEnding } from "@/lib/serialTypes";
import type { ColorParserConfig } from "@/lib/rttColorParser";
import { loadColorParserConfig, saveColorParserConfig } from "@/lib/rttColorParser";

import { startSessionRecording, stopSessionRecording } from "@/lib/sessionCapture";

import {
  loadFromStorage,
  saveToStorage,
  loadStringFromStorage,
  loadNumberFromStorage,
  saveNumberToStorage,
} from "@/lib/storage";

// 图表配置持久化
const CHART_CONFIG_KEY = "rtt_chart_config";
const VIEW_MODE_KEY = "rtt_view_mode";
const SPLIT_RATIO_KEY = "rtt_split_ratio";
const SPLIT_ORIENTATION_KEY = "rtt_split_orientation";
const RTT_RX_FRAMING_KEY = "rtt_rx_framing";
const RTT_START_SETTINGS_KEY = "rtt_start_settings";
const RTT_SEND_SETTINGS_KEY = "rtt_send_settings";
const RTT_MAX_LINES_KEY = "rtt_max_lines";

export const RTT_MAX_LINES_OPTIONS = [10_000, 50_000, 200_000] as const;

/** 启动 RTT 的持久化设置 */
export interface RttStartSettings {
  scanMode: RttScanMode;
  /** 指定地址 / 范围起始地址 */
  scanAddress: number;
  rangeSize: number;
  elfPath: string;
  pollInterval: number;
  haltOnRead: boolean;
  coreIndex: number;
  /** 目标失联多少毫秒后放弃 */
  recoverTimeoutMs: number;
}

export const DEFAULT_RTT_START_SETTINGS: RttStartSettings = {
  scanMode: "auto",
  scanAddress: 0x20000000,
  rangeSize: 0x10000,
  elfPath: "",
  pollInterval: 10,
  haltOnRead: false,
  coreIndex: 0,
  recoverTimeoutMs: 10_000,
};

export interface RttSendSettings {
  channel: number;
  hexMode: boolean;
  encoding: Encoding;
  lineEnding: LineEnding;
}

const DEFAULT_RTT_SEND_SETTINGS: RttSendSettings = {
  channel: 0,
  hexMode: false,
  encoding: "utf-8",
  lineEnding: "lf",
};
let splitRatioSaveTimer: ReturnType<typeof setTimeout> | undefined;

const VIEW_MODE_VALUES = ["text", "chart", "split"] as const;
const SPLIT_ORIENTATION_VALUES = ["vertical", "horizontal"] as const;

interface RttState extends TelemetryChartState {
  // RTT 连接状态
  rttConnected: boolean;
  rttConnecting: boolean;

  // 运行状态
  isRunning: boolean;
  /** 正在扫描控制块（启动命令尚未返回） */
  isStarting: boolean;
  /** 运行中的附加状态：目标复位或重新烧录后为 recovering */
  phase: RttPhase | null;
  /** 当前控制块信息 */
  rttInfo: Pick<RttConfig, "control_block_address" | "located_by" | "session_source"> | null;
  /** 暂停显示：数据继续接收并缓存，继续后一次性补上 */
  isPaused: boolean;
  /** 暂停期间缓存的行数 */
  pausedBacklog: number;
  error: string | null;

  // 通道信息
  upChannels: RttChannel[];
  downChannels: RttChannel[];
  selectedChannel: number; // -1 表示显示所有通道

  // 数据
  lines: RttLine[];
  maxLines: number;

  // 显示设置
  autoScroll: boolean;
  showTimestamp: boolean;
  searchQuery: string;
  displayMode: "text" | "hex"; // 新增：显示模式
  colorParserConfig: ColorParserConfig; // 新增：颜色解析配置

  // 视图模式
  viewMode: ViewMode; // 视图模式：仅文本/仅图表/分屏
  splitRatio: number; // 分屏比例（0-1，表示文本区域占比）
  splitOrientation: SplitOrientation;

  // 配置
  startSettings: RttStartSettings;
  sendSettings: RttSendSettings;

  // 统计
  totalBytes: number;
  lineIdCounter: number;

  // 操作
  setRttConnected: (connected: boolean) => void;
  setRttConnecting: (connecting: boolean) => void;
  setRunning: (running: boolean) => void;
  setStarting: (starting: boolean) => void;
  setPhase: (phase: RttPhase | null) => void;
  /** 启动或重新附加成功后更新通道与控制块信息 */
  applyConfig: (config: RttConfig) => void;
  setPaused: (paused: boolean) => void;
  setPausedBacklog: (count: number) => void;
  setMaxLines: (maxLines: number) => void;
  setError: (error: string | null) => void;
  selectChannel: (index: number) => void;
  addLines: (lines: Omit<RttLine, "id">[]) => void;
  clearLines: () => void;
  setAutoScroll: (enabled: boolean) => void;
  setShowTimestamp: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDisplayMode: (mode: "text" | "hex") => void; // 新增
  setColorParserConfig: (config: ColorParserConfig) => void; // 新增
  setViewMode: (mode: ViewMode) => void; // 新增：设置视图模式
  setSplitRatio: (ratio: number) => void; // 新增：设置分屏比例
  setSplitOrientation: (orientation: SplitOrientation) => void;
  /** 会话录制开关。录制器本身在 lib/sessionCapture.ts 的模块作用域里。 */
  /** 接收分帧设置：决定字节流如何被切成文本行 */
  rxFraming: RxFramingSettings;
  setRxFraming: (settings: Partial<RxFramingSettings>) => void;

  sessionRecording: boolean;
  setSessionRecording: (recording: boolean) => void;
  setStartSettings: (settings: Partial<RttStartSettings>) => void;
  setSendSettings: (settings: Partial<RttSendSettings>) => void;
  addBytes: (count: number) => void;
  reset: () => void;
}

export const useRttStore = create<RttState>((set) => ({
  ...createTelemetryChartSlice(set, { storageKey: CHART_CONFIG_KEY }).state,

  // 初始状态
  rttConnected: false,
  rttConnecting: false,
  isRunning: false,
  isStarting: false,
  phase: null,
  rttInfo: null,
  isPaused: false,
  pausedBacklog: 0,
  error: null,
  upChannels: [],
  downChannels: [],
  selectedChannel: -1,
  lines: [],
  maxLines: loadNumberFromStorage(RTT_MAX_LINES_KEY, 10_000, (n) =>
    (RTT_MAX_LINES_OPTIONS as readonly number[]).includes(n)
  ),
  autoScroll: true,
  showTimestamp: true,
  searchQuery: "",
  displayMode: "text", // 新增：默认文本模式
  colorParserConfig: loadColorParserConfig(), // 新增：从 localStorage 加载配置
  viewMode: loadStringFromStorage(VIEW_MODE_KEY, VIEW_MODE_VALUES, "text"), // 新增：从 localStorage 加载视图模式
  splitRatio: loadNumberFromStorage(SPLIT_RATIO_KEY, 0.4, (n) => n >= 0 && n <= 1), // 新增：从 localStorage 加载分屏比例
  splitOrientation: loadStringFromStorage(SPLIT_ORIENTATION_KEY, SPLIT_ORIENTATION_VALUES, "vertical"),
  startSettings: loadFromStorage(RTT_START_SETTINGS_KEY, DEFAULT_RTT_START_SETTINGS),
  sendSettings: loadFromStorage(RTT_SEND_SETTINGS_KEY, DEFAULT_RTT_SEND_SETTINGS),
  totalBytes: 0,
  lineIdCounter: 0,

  setRttConnected: (rttConnected) => set({ rttConnected }),

  setRttConnecting: (rttConnecting) => set({ rttConnecting }),

  // 停止时一并解除暂停：否则下次启动仍处于暂停，数据只进缓存不显示
  setRunning: (isRunning) =>
    set(isRunning ? { isRunning, error: null } : { isRunning, isPaused: false, phase: null, isStarting: false }),

  setStarting: (isStarting) => set({ isStarting }),

  setPhase: (phase) => set({ phase }),

  applyConfig: (config) =>
    set({
      upChannels: config.up_channels,
      downChannels: config.down_channels,
      rttInfo: {
        control_block_address: config.control_block_address,
        located_by: config.located_by,
        session_source: config.session_source,
      },
    }),

  setPaused: (isPaused) => set({ isPaused }),

  setPausedBacklog: (pausedBacklog) => set({ pausedBacklog }),

  setMaxLines: (maxLines) => {
    saveNumberToStorage(RTT_MAX_LINES_KEY, maxLines);
    set((state) => ({ maxLines, lines: state.lines.length > maxLines ? state.lines.slice(-maxLines) : state.lines }));
  },

  setError: (error) =>
    set(error ? { error, isRunning: false, isPaused: false, phase: null, isStarting: false } : { error }),

  selectChannel: (selectedChannel) => set({ selectedChannel }),

  addLines: (newLines) =>
    set((state) => {
      let idCounter = state.lineIdCounter;
      const linesWithId: RttLine[] = newLines.map((line) => ({
        ...line,
        id: ++idCounter,
      }));
      // 只在超出上限时裁剪：避免每批数据都额外复制一次整个缓冲区
      const overflow = state.lines.length + linesWithId.length - state.maxLines;
      const lines =
        overflow > 0
          ? state.lines.slice(Math.min(overflow, state.lines.length)).concat(linesWithId.slice(-state.maxLines))
          : state.lines.concat(linesWithId);
      return { lines, lineIdCounter: idCounter };
    }),

  clearLines: () => set({ lines: [], lineIdCounter: 0, totalBytes: 0, pausedBacklog: 0 }),

  setAutoScroll: (autoScroll) => set({ autoScroll }),

  setShowTimestamp: (showTimestamp) => set({ showTimestamp }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setDisplayMode: (displayMode) => set({ displayMode }), // 新增

  setColorParserConfig: (colorParserConfig) => {
    saveColorParserConfig(colorParserConfig); // 保存到 localStorage
    set({ colorParserConfig });
  },

  setViewMode: (viewMode) => {
    saveToStorage(VIEW_MODE_KEY, viewMode);
    set({ viewMode });
  },

  setSplitRatio: (splitRatio) => {
    set({ splitRatio });
    clearTimeout(splitRatioSaveTimer);
    splitRatioSaveTimer = setTimeout(() => saveNumberToStorage(SPLIT_RATIO_KEY, splitRatio), 150);
  },

  setSplitOrientation: (splitOrientation) => {
    saveToStorage(SPLIT_ORIENTATION_KEY, splitOrientation);
    set({ splitOrientation });
  },

  rxFraming: loadFromStorage(RTT_RX_FRAMING_KEY, DEFAULT_RX_FRAMING),
  setRxFraming: (settings) =>
    set((state) => {
      const next = { ...state.rxFraming, ...settings };
      saveToStorage(RTT_RX_FRAMING_KEY, next);
      return { rxFraming: next };
    }),

  sessionRecording: false,
  setSessionRecording: (recording) => {
    if (recording) startSessionRecording("rtt");
    else stopSessionRecording("rtt");
    set({ sessionRecording: recording });
  },

  setStartSettings: (settings) =>
    set((state) => {
      const next = { ...state.startSettings, ...settings };
      saveToStorage(RTT_START_SETTINGS_KEY, next);
      return { startSettings: next };
    }),

  setSendSettings: (settings) =>
    set((state) => {
      const next = { ...state.sendSettings, ...settings };
      saveToStorage(RTT_SEND_SETTINGS_KEY, next);
      return { sendSettings: next };
    }),

  addBytes: (count) => set((state) => ({ totalBytes: state.totalBytes + count })),

  reset: () =>
    set({
      rttConnected: false,
      rttConnecting: false,
      isRunning: false,
      isStarting: false,
      phase: null,
      rttInfo: null,
      isPaused: false,
      pausedBacklog: 0,
      error: null,
      upChannels: [],
      downChannels: [],
      lines: [],
      totalBytes: 0,
      lineIdCounter: 0,
    }),
}));
