import { createTelemetryChartSlice, type TelemetryChartState } from "./telemetryChartSlice";
import { create } from "zustand";
import type { RxFramingSettings } from "@/lib/serialTypes";
import { DEFAULT_RX_FRAMING } from "@/lib/serialTypes";
import type {
  BleCharacteristic,
  BleDeviceInfo,
  BleLine,
  BleService,
  BleStats,
  BluetoothConnectionMode,
  BleWriteResponseMode,
} from "@/lib/bleTypes";
import type { Encoding, LineEnding, SerialPortInfo } from "@/lib/serialTypes";
import type { ColorParserConfig } from "@/lib/rttColorParser";
import { loadColorParserConfig, saveColorParserConfig } from "@/lib/rttColorParser";
import type { ViewMode, SplitOrientation } from "@/lib/chartTypes";

import { startSessionRecording, stopSessionRecording } from "@/lib/sessionCapture";

import {
  loadBooleanFromStorage,
  loadFromStorage,
  saveToStorage,
  loadStringFromStorage,
  loadNumberFromStorage,
  saveNumberToStorage,
} from "@/lib/storage";

// 持久化 key
const BLE_CHART_CONFIG_KEY = "ble_chart_config";
const BLE_VIEW_MODE_KEY = "ble_view_mode";
const BLE_SPLIT_RATIO_KEY = "ble_split_ratio";
const BLE_SPLIT_ORIENTATION_KEY = "ble_split_orientation";
const BLE_SEND_SETTINGS_KEY = "ble_send_settings";
const BLE_SHOW_DIRECTION_PREFIX_KEY = "ble_show_direction_prefix";
const BLE_AUTO_SCROLL_KEY = "ble_auto_scroll";
const BLE_SHOW_TIMESTAMP_KEY = "ble_show_timestamp";
const BLE_DISPLAY_MODE_KEY = "ble_display_mode";
const BLE_CONNECTION_MODE_KEY = "ble_connection_mode";
const BLE_RX_FRAMING_KEY = "ble_rx_framing";
let splitRatioSaveTimer: ReturnType<typeof setTimeout> | undefined;

const CONNECTION_MODE_VALUES = ["ble", "spp"] as const;
const VIEW_MODE_VALUES = ["text", "chart", "split"] as const;
const SPLIT_ORIENTATION_VALUES = ["vertical", "horizontal"] as const;
const DISPLAY_MODE_VALUES = ["text", "hex"] as const;

interface SendSettings {
  encoding: Encoding;
  lineEnding: LineEnding;
  hexMode: boolean;
  withResponse: BleWriteResponseMode;
}

const defaultSendSettings: SendSettings = {
  encoding: "utf-8",
  lineEnding: "lf",
  hexMode: false,
  withResponse: "auto",
};

interface BluetoothState extends TelemetryChartState {
  // 工作模式（BLE / SPP）
  connectionMode: BluetoothConnectionMode;

  // 经典蓝牙 SPP：本地虚拟 COM 端口列表（由前端过滤 listSerialPorts 得到）
  sppPorts: SerialPortInfo[];
  sppLoading: boolean;

  // 连接 / 扫描
  scanning: boolean;
  connecting: boolean;
  connected: boolean;
  running: boolean; // 是否正在订阅 notify
  error: string | null;

  // 发现的设备
  discoveredDevices: BleDeviceInfo[];
  connectedDevice: BleDeviceInfo | null;

  // 服务 / 特征
  services: BleService[];
  notifyCharUuid: string | null;
  writeCharUuid: string | null;

  // 数据
  lines: BleLine[];
  maxLines: number;
  stats: BleStats;
  lineIdCounter: number;

  // 显示
  autoScroll: boolean;
  showTimestamp: boolean;
  showDirectionPrefix: boolean;
  searchQuery: string;
  displayMode: "text" | "hex";
  colorParserConfig: ColorParserConfig;

  // 视图
  viewMode: ViewMode;
  splitRatio: number;
  splitOrientation: SplitOrientation;

  // 图表

  // 发送
  sendSettings: SendSettings;

  // Actions
  setConnectionMode: (mode: BluetoothConnectionMode) => void;
  setSppPorts: (ports: SerialPortInfo[]) => void;
  setSppLoading: (loading: boolean) => void;

  setScanning: (scanning: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setConnected: (connected: boolean) => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;

  setDiscoveredDevices: (devices: BleDeviceInfo[]) => void;
  setConnectedDevice: (device: BleDeviceInfo | null) => void;

  setServices: (services: BleService[]) => void;
  setNotifyCharUuid: (uuid: string | null) => void;
  setWriteCharUuid: (uuid: string | null) => void;

  addLines: (lines: Omit<BleLine, "id">[]) => void;
  clearLines: () => void;
  updateStats: (stats: BleStats) => void;

  setAutoScroll: (value: boolean) => void;
  setShowTimestamp: (value: boolean) => void;
  setShowDirectionPrefix: (value: boolean) => void;
  setSearchQuery: (value: string) => void;
  setDisplayMode: (value: "text" | "hex") => void;
  setColorParserConfig: (cfg: ColorParserConfig) => void;

  setViewMode: (mode: ViewMode) => void;
  setSplitRatio: (ratio: number) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;

  /** 会话录制开关。录制器本身在 lib/sessionCapture.ts 的模块作用域里。 */
  /** 接收分帧设置：决定字节流如何被切成文本行 */
  rxFraming: RxFramingSettings;
  setRxFraming: (settings: Partial<RxFramingSettings>) => void;

  sessionRecording: boolean;
  setSessionRecording: (recording: boolean) => void;

  setSendSettings: (settings: Partial<SendSettings>) => void;

  reset: () => void;
}

function findCharByProps(services: BleService[], pred: (c: BleCharacteristic) => boolean): string | null {
  for (const s of services) {
    for (const c of s.characteristics) {
      if (pred(c)) return c.uuid;
    }
  }
  return null;
}

export const useBluetoothStore = create<BluetoothState>((set, get) => ({
  ...createTelemetryChartSlice(set, { storageKey: BLE_CHART_CONFIG_KEY }).state,

  connectionMode: loadStringFromStorage(BLE_CONNECTION_MODE_KEY, CONNECTION_MODE_VALUES, "ble"),

  sppPorts: [],
  sppLoading: false,

  scanning: false,
  connecting: false,
  connected: false,
  running: false,
  error: null,

  discoveredDevices: [],
  connectedDevice: null,

  services: [],
  notifyCharUuid: null,
  writeCharUuid: null,

  lines: [],
  maxLines: 10000,
  stats: { bytes_received: 0, bytes_sent: 0 },
  lineIdCounter: 0,

  autoScroll: loadBooleanFromStorage(BLE_AUTO_SCROLL_KEY, true),
  showTimestamp: loadBooleanFromStorage(BLE_SHOW_TIMESTAMP_KEY, true),
  showDirectionPrefix: loadBooleanFromStorage(BLE_SHOW_DIRECTION_PREFIX_KEY, true),
  searchQuery: "",
  displayMode: loadStringFromStorage(BLE_DISPLAY_MODE_KEY, DISPLAY_MODE_VALUES, "text"),
  colorParserConfig: loadColorParserConfig(),

  viewMode: loadStringFromStorage(BLE_VIEW_MODE_KEY, VIEW_MODE_VALUES, "text"),
  splitRatio: loadNumberFromStorage(BLE_SPLIT_RATIO_KEY, 0.4, (n) => n >= 0 && n <= 1),
  splitOrientation: loadStringFromStorage(BLE_SPLIT_ORIENTATION_KEY, SPLIT_ORIENTATION_VALUES, "vertical"),

  sendSettings: loadFromStorage(BLE_SEND_SETTINGS_KEY, defaultSendSettings),

  setConnectionMode: (mode) => {
    saveToStorage(BLE_CONNECTION_MODE_KEY, mode);
    set({ connectionMode: mode });
  },
  setSppPorts: (ports) => set({ sppPorts: ports }),
  setSppLoading: (loading) => set({ sppLoading: loading }),

  setScanning: (scanning) => set({ scanning }),
  setConnecting: (connecting) => set({ connecting }),
  setConnected: (connected) => set((state) => ({ connected, running: connected ? state.running : false })),
  setRunning: (running) => set({ running, error: null }),
  setError: (error) => set({ error }),

  setDiscoveredDevices: (discoveredDevices) => set({ discoveredDevices }),
  setConnectedDevice: (connectedDevice) => set({ connectedDevice }),

  setServices: (services) => {
    const state = get();
    // 服务变更时若当前选择已不存在，则清空
    const flatChars = services.flatMap((s) => s.characteristics);
    const notifyExists = state.notifyCharUuid ? flatChars.some((c) => c.uuid === state.notifyCharUuid) : false;
    const writeExists = state.writeCharUuid ? flatChars.some((c) => c.uuid === state.writeCharUuid) : false;
    set({
      services,
      notifyCharUuid: notifyExists ? state.notifyCharUuid : null,
      writeCharUuid: writeExists ? state.writeCharUuid : null,
    });
  },
  setNotifyCharUuid: (uuid) => set({ notifyCharUuid: uuid }),
  setWriteCharUuid: (uuid) => set({ writeCharUuid: uuid }),

  addLines: (newLines) =>
    set((state) => {
      let id = state.lineIdCounter;
      const linesWithId: BleLine[] = newLines.map((line) => ({
        ...line,
        id: ++id,
      }));
      const lines = [...state.lines, ...linesWithId].slice(-state.maxLines);
      return { lines, lineIdCounter: id };
    }),

  clearLines: () =>
    set({
      lines: [],
      lineIdCounter: 0,
      stats: { bytes_received: 0, bytes_sent: 0 },
    }),

  updateStats: (stats) => set({ stats }),

  setAutoScroll: (value) => {
    saveToStorage(BLE_AUTO_SCROLL_KEY, value);
    set({ autoScroll: value });
  },
  setShowTimestamp: (value) => {
    saveToStorage(BLE_SHOW_TIMESTAMP_KEY, value);
    set({ showTimestamp: value });
  },
  setShowDirectionPrefix: (value) => {
    saveToStorage(BLE_SHOW_DIRECTION_PREFIX_KEY, value);
    set({ showDirectionPrefix: value });
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDisplayMode: (value) => {
    saveToStorage(BLE_DISPLAY_MODE_KEY, value);
    set({ displayMode: value });
  },
  setColorParserConfig: (cfg) => {
    saveColorParserConfig(cfg);
    set({ colorParserConfig: cfg });
  },

  setViewMode: (mode) => {
    saveToStorage(BLE_VIEW_MODE_KEY, mode);
    set({ viewMode: mode });
  },
  setSplitRatio: (ratio) => {
    set({ splitRatio: ratio });
    clearTimeout(splitRatioSaveTimer);
    splitRatioSaveTimer = setTimeout(() => saveNumberToStorage(BLE_SPLIT_RATIO_KEY, ratio), 150);
  },
  setSplitOrientation: (orientation) => {
    saveToStorage(BLE_SPLIT_ORIENTATION_KEY, orientation);
    set({ splitOrientation: orientation });
  },

  rxFraming: loadFromStorage(BLE_RX_FRAMING_KEY, DEFAULT_RX_FRAMING),
  setRxFraming: (settings) =>
    set((state) => {
      const next = { ...state.rxFraming, ...settings };
      saveToStorage(BLE_RX_FRAMING_KEY, next);
      return { rxFraming: next };
    }),

  sessionRecording: false,
  setSessionRecording: (recording) => {
    if (recording) startSessionRecording("bluetooth");
    else stopSessionRecording("bluetooth");
    set({ sessionRecording: recording });
  },

  setSendSettings: (settings) =>
    set((state) => {
      const next = { ...state.sendSettings, ...settings };
      saveToStorage(BLE_SEND_SETTINGS_KEY, next);
      return { sendSettings: next };
    }),

  reset: () =>
    set({
      scanning: false,
      connecting: false,
      connected: false,
      running: false,
      error: null,
      discoveredDevices: [],
      connectedDevice: null,
      services: [],
      notifyCharUuid: null,
      writeCharUuid: null,
      lines: [],
      lineIdCounter: 0,
      stats: { bytes_received: 0, bytes_sent: 0 },
    }),
}));

/** 找到第一个支持 notify/indicate 的特征 UUID */
export function pickDefaultNotifyChar(services: BleService[]): string | null {
  return findCharByProps(services, (c) => c.properties.notify || c.properties.indicate);
}

/** 找到第一个支持 write 的特征 UUID */
export function pickDefaultWriteChar(services: BleService[]): string | null {
  return findCharByProps(services, (c) => c.properties.write || c.properties.write_without_response);
}
