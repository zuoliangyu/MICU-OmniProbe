import { createTelemetryChartSlice, type TelemetryChartState } from "./telemetryChartSlice";
import type { ViewMode, SplitOrientation } from "@/lib/chartTypes";
import { create } from "zustand";
import type { RxFramingSettings } from "@/lib/serialTypes";
import { DEFAULT_RX_FRAMING } from "@/lib/serialTypes";
import type { RttChannel, RttLine, RttScanMode } from "@/lib/types";
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
let splitRatioSaveTimer: ReturnType<typeof setTimeout> | undefined;

const VIEW_MODE_VALUES = ["text", "chart", "split"] as const;
const SPLIT_ORIENTATION_VALUES = ["vertical", "horizontal"] as const;

interface RttState extends TelemetryChartState {
  // RTT 连接状态
  rttConnected: boolean;
  rttConnecting: boolean;

  // 运行状态
  isRunning: boolean;
  isPaused: boolean;
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
  scanMode: RttScanMode;
  scanAddress: number;
  pollInterval: number;

  // 统计
  totalBytes: number;
  lineIdCounter: number;

  // 操作
  setRttConnected: (connected: boolean) => void;
  setRttConnecting: (connecting: boolean) => void;
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setError: (error: string | null) => void;
  setChannels: (upChannels: RttChannel[], downChannels: RttChannel[]) => void;
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
  setScanMode: (mode: RttScanMode) => void;
  setScanAddress: (address: number) => void;
  setPollInterval: (interval: number) => void;
  addBytes: (count: number) => void;
  reset: () => void;
}

export const useRttStore = create<RttState>((set) => ({
  ...createTelemetryChartSlice(set, { storageKey: CHART_CONFIG_KEY }).state,

  // 初始状态
  rttConnected: false,
  rttConnecting: false,
  isRunning: false,
  isPaused: false,
  error: null,
  upChannels: [],
  downChannels: [],
  selectedChannel: -1,
  lines: [],
  maxLines: 10000,
  autoScroll: true,
  showTimestamp: true,
  searchQuery: "",
  displayMode: "text", // 新增：默认文本模式
  colorParserConfig: loadColorParserConfig(), // 新增：从 localStorage 加载配置
  viewMode: loadStringFromStorage(VIEW_MODE_KEY, VIEW_MODE_VALUES, "text"), // 新增：从 localStorage 加载视图模式
  splitRatio: loadNumberFromStorage(SPLIT_RATIO_KEY, 0.4, (n) => n >= 0 && n <= 1), // 新增：从 localStorage 加载分屏比例
  splitOrientation: loadStringFromStorage(SPLIT_ORIENTATION_KEY, SPLIT_ORIENTATION_VALUES, "vertical"),
  scanMode: "auto",
  scanAddress: 0x20000000,
  pollInterval: 10, // 默认 10ms，更快的轮询
  totalBytes: 0,
  lineIdCounter: 0,

  setRttConnected: (rttConnected) => set({ rttConnected }),

  setRttConnecting: (rttConnecting) => set({ rttConnecting }),

  setRunning: (isRunning) => set({ isRunning, error: null }),

  setPaused: (isPaused) => set({ isPaused }),

  setError: (error) => set({ error, isRunning: false }),

  setChannels: (upChannels, downChannels) => set({ upChannels, downChannels }),

  selectChannel: (selectedChannel) => set({ selectedChannel }),

  addLines: (newLines) =>
    set((state) => {
      let idCounter = state.lineIdCounter;
      const linesWithId: RttLine[] = newLines.map((line) => ({
        ...line,
        id: ++idCounter,
      }));
      const lines = [...state.lines, ...linesWithId].slice(-state.maxLines);
      return { lines, lineIdCounter: idCounter };
    }),

  clearLines: () => set({ lines: [], lineIdCounter: 0, totalBytes: 0 }),

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

  setScanMode: (scanMode) => set({ scanMode }),

  setScanAddress: (scanAddress) => set({ scanAddress }),

  setPollInterval: (pollInterval) => set({ pollInterval }),

  addBytes: (count) => set((state) => ({ totalBytes: state.totalBytes + count })),

  reset: () =>
    set({
      rttConnected: false,
      rttConnecting: false,
      isRunning: false,
      isPaused: false,
      error: null,
      upChannels: [],
      downChannels: [],
      lines: [],
      totalBytes: 0,
      lineIdCounter: 0,
    }),
}));
