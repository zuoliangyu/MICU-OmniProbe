import { createTelemetryChartSlice, type TelemetryChartState } from "./telemetryChartSlice";
import { create } from "zustand";
import type {
  SerialConfig,
  SerialLine,
  SerialStats,
  DataSourceType,
  LineEnding,
  Encoding,
  LocalSerialConfig,
  TcpSerialConfig,
  UdpSerialConfig,
  SimulationSerialConfig,
  SerialTerminalLine,
  SerialTextViewMode,
  SerialTerminalSettings,
  RxFramingSettings,
  AiBridgeStatus,
} from "@/lib/serialTypes";
import { DEFAULT_AI_BRIDGE_STATUS, DEFAULT_RX_FRAMING } from "@/lib/serialTypes";
import type { ColorParserConfig } from "@/lib/rttColorParser";
import { loadColorParserConfig, saveColorParserConfig } from "@/lib/rttColorParser";
import type { ViewMode, SplitOrientation } from "@/lib/chartTypes";
import { migrateChartConfig } from "@/lib/chartTypes";

import { startSessionRecording, stopSessionRecording } from "@/lib/sessionCapture";

import type { SerialReceiveResult } from "@/lib/serialReceivePipeline";
import { DEFAULT_TIMESTAMP_FORMAT } from "@/lib/formatters";
import {
  loadBooleanFromStorage,
  loadFromStorage,
  saveToStorage,
  loadStringFromStorage,
  loadNumberFromStorage,
  saveNumberToStorage,
} from "@/lib/storage";

// Persistence keys
const SERIAL_CONFIG_KEY = "serial_config";
const SERIAL_CHART_CONFIG_KEY = "serial_chart_config";
const SERIAL_VIEW_MODE_KEY = "serial_view_mode";
const SERIAL_SPLIT_RATIO_KEY = "serial_split_ratio";
const SERIAL_SPLIT_ORIENTATION_KEY = "serial_split_orientation";
const SERIAL_SEND_SETTINGS_KEY = "serial_send_settings";
const SERIAL_TIMESTAMP_SETTINGS_KEY = "serial_timestamp_settings";
const SERIAL_SHOW_DIRECTION_PREFIX_KEY = "serial_show_direction_prefix";
const SERIAL_DISPLAY_MODE_KEY = "serial_display_mode";
const SERIAL_TEXT_VIEW_MODE_KEY = "serial_text_view_mode";
const SERIAL_TERMINAL_SETTINGS_KEY = "serial_terminal_settings";
const SERIAL_RX_FRAMING_KEY = "serial_rx_framing";
const SERIAL_TERMINAL_SETTINGS_VERSION_KEY = "serial_terminal_settings_version";
const SERIAL_TERMINAL_SETTINGS_VERSION = 3;
let splitRatioSaveTimer: ReturnType<typeof setTimeout> | undefined;

const VIEW_MODE_VALUES = ["text", "chart", "split"] as const;
const TEXT_VIEW_MODE_VALUES = ["log", "terminal"] as const;
const DISPLAY_MODE_VALUES = ["text", "hex"] as const;
const SPLIT_ORIENTATION_VALUES = ["vertical", "horizontal"] as const;
const ANSI_ESCAPE_SEQUENCE_REGEX = /^\x1b\[[0-?]*[ -/]*[@-~]/;
const MAX_TERMINAL_ACTIVE_UNITS = 4096;
const MAX_TERMINAL_PENDING_ESCAPE_CHARS = 64;

// Default local serial config
const defaultLocalConfig: LocalSerialConfig = {
  type: "local",
  port: "",
  baud_rate: 115200,
  data_bits: 8,
  stop_bits: 1,
  parity: "none",
  flow_control: "none",
  dtr: false,
  rts: false,
  reconnect: false,
};

// Default TCP config
const defaultTcpConfig: TcpSerialConfig = {
  type: "tcp",
  host: "192.168.1.1",
  port: 8080,
  reconnect: false,
};

const defaultUdpConfig: UdpSerialConfig = {
  type: "udp",
  local_host: "0.0.0.0",
  local_port: 9000,
  remote_host: "192.168.1.1",
  remote_port: 9000,
};

const defaultSimulationConfig: SimulationSerialConfig = {
  preset: "waveform",
  sampleRateHz: 50,
  frequencyHz: 0.25,
  amplitude: 1,
  offset: 0,
  noise: 0,
  channelCount: 2,
  waveform: "sine",
  xyPattern: "circle",
};

interface SendSettings {
  encoding: Encoding;
  lineEnding: LineEnding;
  hexMode: boolean;
}

type TerminalUnit = { kind: "char"; value: string } | { kind: "ansi"; value: string };

type TerminalToken =
  { type: "char"; value: string } | { type: "ansi"; value: string } | { type: "cr" } | { type: "lf" } | { type: "bs" };

const defaultSerialConfigBundle = {
  local: defaultLocalConfig,
  tcp: defaultTcpConfig,
  udp: defaultUdpConfig,
  simulation: defaultSimulationConfig,
  activeType: "local" as DataSourceType,
};
const defaultSendSettings: SendSettings = { encoding: "utf-8", lineEnding: "lf", hexMode: false };
const defaultTerminalSettings: SerialTerminalSettings = {
  localEcho: false,
  interceptShortcuts: true,
  lineMode: false,
};

export type SerialInspectorTab = "connection" | "data" | "widget";

interface SerialState extends TelemetryChartState {
  // Connection state
  connected: boolean;
  connecting: boolean;
  running: boolean;
  error: string | null;
  aiBridgeStatus: AiBridgeStatus;

  // Configuration
  localConfig: LocalSerialConfig;
  tcpConfig: TcpSerialConfig;
  udpConfig: UdpSerialConfig;
  simulationConfig: SimulationSerialConfig;
  activeSourceType: DataSourceType;

  // Data
  lines: SerialLine[];
  maxLines: number;
  stats: SerialStats;

  // Display settings
  autoScroll: boolean;
  showTimestamp: boolean;
  timestampFormat: string;
  showDirectionPrefix: boolean;
  splitByDirection: boolean;
  searchQuery: string;
  displayMode: "text" | "hex";
  colorParserConfig: ColorParserConfig;
  textViewMode: SerialTextViewMode;
  inspectorTab: SerialInspectorTab;

  // Terminal state
  terminalLines: SerialTerminalLine[];
  terminalActiveLine: string;
  terminalActiveUnits: TerminalUnit[];
  terminalCursorColumn: number;
  terminalPendingEscape: string;
  terminalLineCounter: number;
  maxTerminalLines: number;
  terminalSettings: SerialTerminalSettings;

  // View mode
  viewMode: ViewMode;
  splitRatio: number;
  splitOrientation: SplitOrientation;

  // Send settings
  sendSettings: SendSettings;

  // 接收分帧设置（决定日志模式如何把字节切成行）
  rxFraming: RxFramingSettings;

  // Line ID counter
  lineIdCounter: number;

  // Actions
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;
  setAiBridgeStatus: (status: AiBridgeStatus) => void;

  setLocalConfig: (config: Partial<LocalSerialConfig>) => void;
  setTcpConfig: (config: Partial<TcpSerialConfig>) => void;
  setUdpConfig: (config: Partial<UdpSerialConfig>) => void;
  setSimulationConfig: (config: Partial<SimulationSerialConfig>) => void;
  setActiveSourceType: (type: DataSourceType) => void;
  getActiveConfig: () => SerialConfig;

  addLine: (line: Omit<SerialLine, "id">) => void;
  addLines: (lines: Omit<SerialLine, "id">[]) => void;
  clearLines: () => void;
  updateStats: (stats: SerialStats) => void;
  commitSerialReceiveBatch: (batch: SerialReceiveResult) => void;

  /** 会话录制开关。录制器本身在 lib/sessionCapture.ts 的模块作用域里。 */
  sessionRecording: boolean;
  setSessionRecording: (recording: boolean) => void;

  setAutoScroll: (enabled: boolean) => void;
  setShowTimestamp: (show: boolean) => void;
  setTimestampFormat: (format: string) => void;
  setShowDirectionPrefix: (show: boolean) => void;
  setSplitByDirection: (split: boolean) => void;
  setSearchQuery: (query: string) => void;
  setDisplayMode: (mode: "text" | "hex") => void;
  setColorParserConfig: (config: ColorParserConfig) => void;
  setTextViewMode: (mode: SerialTextViewMode) => void;
  setInspectorTab: (tab: SerialInspectorTab) => void;

  appendTerminalChunk: (text: string) => void;
  clearTerminalBuffer: () => void;
  setTerminalSettings: (settings: Partial<SerialTerminalSettings>) => void;

  setViewMode: (mode: ViewMode) => void;
  setSplitRatio: (ratio: number) => void;
  setSplitOrientation: (orientation: SplitOrientation) => void;

  setSendSettings: (settings: Partial<SendSettings>) => void;
  setRxFraming: (settings: Partial<RxFramingSettings>) => void;

  reset: () => void;
}

const savedConfig = loadFromStorage(SERIAL_CONFIG_KEY, defaultSerialConfigBundle);
const savedSendSettings = loadFromStorage(SERIAL_SEND_SETTINGS_KEY, defaultSendSettings);
const loadedTimestampSettings = loadFromStorage(SERIAL_TIMESTAMP_SETTINGS_KEY, {
  show: true,
  format: DEFAULT_TIMESTAMP_FORMAT,
});
const savedTimestampSettings = {
  show: typeof loadedTimestampSettings.show === "boolean" ? loadedTimestampSettings.show : true,
  format:
    typeof loadedTimestampSettings.format === "string" && loadedTimestampSettings.format.trim()
      ? loadedTimestampSettings.format.slice(0, 80)
      : DEFAULT_TIMESTAMP_FORMAT,
};
// 合并默认值，保证老配置缺字段时也有完整结构
const savedRxFraming: RxFramingSettings = {
  ...DEFAULT_RX_FRAMING,
  ...loadFromStorage(SERIAL_RX_FRAMING_KEY, DEFAULT_RX_FRAMING),
};
const savedTerminalSettingsVersion = loadNumberFromStorage(
  SERIAL_TERMINAL_SETTINGS_VERSION_KEY,
  0,
  (value) => value >= 0
);
const loadedTerminalSettings = loadFromStorage(SERIAL_TERMINAL_SETTINGS_KEY, defaultTerminalSettings);
const savedTerminalSettings: SerialTerminalSettings =
  savedTerminalSettingsVersion < SERIAL_TERMINAL_SETTINGS_VERSION
    ? {
        ...loadedTerminalSettings,
        localEcho: false,
      }
    : loadedTerminalSettings;

if (savedTerminalSettingsVersion < SERIAL_TERMINAL_SETTINGS_VERSION) {
  saveToStorage(SERIAL_TERMINAL_SETTINGS_KEY, savedTerminalSettings);
  saveNumberToStorage(SERIAL_TERMINAL_SETTINGS_VERSION_KEY, SERIAL_TERMINAL_SETTINGS_VERSION);
}

function getVisibleLength(units: TerminalUnit[]) {
  return units.filter((unit) => unit.kind === "char").length;
}

function getVisibleUnitIndex(units: TerminalUnit[], visibleIndex: number) {
  let currentVisible = 0;

  for (let index = 0; index < units.length; index += 1) {
    if (units[index].kind !== "char") {
      continue;
    }

    if (currentVisible === visibleIndex) {
      return index;
    }

    currentVisible += 1;
  }

  return -1;
}

function getInsertionIndex(units: TerminalUnit[], cursorColumn: number) {
  let currentVisible = 0;

  for (let index = 0; index < units.length; index += 1) {
    if (units[index].kind !== "char") {
      continue;
    }

    if (currentVisible === cursorColumn) {
      return index;
    }

    currentVisible += 1;
  }

  return units.length;
}

function unitsToText(units: TerminalUnit[]) {
  return units.map((unit) => unit.value).join("");
}

function tokenizeTerminalChunk(
  text: string,
  pendingEscape: string
): { tokens: TerminalToken[]; pendingEscape: string } {
  const tokens: TerminalToken[] = [];
  const combined = pendingEscape + text;
  let index = 0;

  while (index < combined.length) {
    const char = combined[index];

    if (char === "\x1b") {
      const match = combined.slice(index).match(ANSI_ESCAPE_SEQUENCE_REGEX);
      if (!match) {
        if (combined.length - index > MAX_TERMINAL_PENDING_ESCAPE_CHARS) {
          tokens.push({ type: "char", value: char });
          index += 1;
          continue;
        }
        return { tokens, pendingEscape: combined.slice(index) };
      }

      tokens.push({ type: "ansi", value: match[0] });
      index += match[0].length;
      continue;
    }

    if (char === "\r") {
      tokens.push({ type: "cr" });
      index += 1;
      continue;
    }

    if (char === "\n") {
      tokens.push({ type: "lf" });
      index += 1;
      continue;
    }

    if (char === "\b") {
      tokens.push({ type: "bs" });
      index += 1;
      continue;
    }

    tokens.push({ type: "char", value: char });
    index += 1;
  }

  return { tokens, pendingEscape: "" };
}

function processTerminalChunk(
  text: string,
  state: Pick<
    SerialState,
    | "terminalLines"
    | "terminalActiveUnits"
    | "terminalCursorColumn"
    | "terminalPendingEscape"
    | "terminalLineCounter"
    | "maxTerminalLines"
  >
) {
  // 只在真正提交新行时才复制 terminalLines，避免无 \n 的 chunk
  // (如键盘回显、连续刷新) 反复深拷贝 4000 元素的数组
  let lines: SerialTerminalLine[] | null = null;
  const activeUnits = state.terminalActiveUnits.slice();
  let cursorColumn = state.terminalCursorColumn;
  let lineCounter = state.terminalLineCounter;

  const pushCommittedLine = () => {
    if (lines === null) {
      lines = state.terminalLines.slice();
    }
    lineCounter += 1;
    lines.push({
      id: lineCounter,
      text: unitsToText(activeUnits),
    });

    if (lines.length > state.maxTerminalLines) {
      lines.splice(0, lines.length - state.maxTerminalLines);
    }

    activeUnits.length = 0;
    cursorColumn = 0;
  };

  const { tokens, pendingEscape } = tokenizeTerminalChunk(text, state.terminalPendingEscape);

  for (const token of tokens) {
    if (token.type === "cr") {
      cursorColumn = 0;
      continue;
    }

    if (token.type === "lf") {
      pushCommittedLine();
      continue;
    }

    if (token.type === "bs") {
      if (cursorColumn === 0) {
        continue;
      }

      cursorColumn -= 1;
      const removeIndex = getVisibleUnitIndex(activeUnits, cursorColumn);
      if (removeIndex >= 0) {
        activeUnits.splice(removeIndex, 1);
      }
      continue;
    }

    if (token.type === "ansi") {
      const insertionIndex = getInsertionIndex(activeUnits, cursorColumn);
      activeUnits.splice(insertionIndex, 0, { kind: "ansi", value: token.value });
      if (activeUnits.length >= MAX_TERMINAL_ACTIVE_UNITS) pushCommittedLine();
      continue;
    }

    const visibleLength = getVisibleLength(activeUnits);
    if (cursorColumn < visibleLength) {
      const replaceIndex = getVisibleUnitIndex(activeUnits, cursorColumn);
      if (replaceIndex >= 0) {
        activeUnits[replaceIndex] = { kind: "char", value: token.value };
      }
    } else {
      const insertionIndex = getInsertionIndex(activeUnits, cursorColumn);
      activeUnits.splice(insertionIndex, 0, { kind: "char", value: token.value });
    }

    cursorColumn += 1;
    if (activeUnits.length >= MAX_TERMINAL_ACTIVE_UNITS) pushCommittedLine();
  }

  return {
    terminalLines: lines ?? state.terminalLines,
    terminalActiveUnits: activeUnits,
    terminalActiveLine: unitsToText(activeUnits),
    terminalCursorColumn: cursorColumn,
    terminalPendingEscape: pendingEscape,
    terminalLineCounter: lineCounter,
  };
}

function appendSerialLines(
  state: Pick<SerialState, "lines" | "maxLines" | "lineIdCounter">,
  newLines: Omit<SerialLine, "id">[]
) {
  let lineIdCounter = state.lineIdCounter;
  const linesWithId: SerialLine[] = newLines.map((line) => ({ ...line, id: ++lineIdCounter }));
  return {
    lines: state.lines.concat(linesWithId).slice(-state.maxLines),
    lineIdCounter,
  };
}

export const useSerialStore = create<SerialState>((set, get) => {
  const chartSlice = createTelemetryChartSlice(set, { storageKey: SERIAL_CHART_CONFIG_KEY });

  return {
    ...chartSlice.state,

    // Initial state
    connected: false,
    connecting: false,
    running: false,
    error: null,
    aiBridgeStatus: DEFAULT_AI_BRIDGE_STATUS,

    localConfig: savedConfig.local,
    tcpConfig: savedConfig.tcp,
    udpConfig: savedConfig.udp ?? defaultUdpConfig,
    simulationConfig: savedConfig.simulation ?? defaultSimulationConfig,
    activeSourceType: savedConfig.activeType,

    lines: [],
    maxLines: 10000,
    stats: { bytes_received: 0, bytes_sent: 0 },

    autoScroll: true,
    showTimestamp: savedTimestampSettings.show,
    timestampFormat: savedTimestampSettings.format,
    showDirectionPrefix: loadBooleanFromStorage(SERIAL_SHOW_DIRECTION_PREFIX_KEY, true),
    splitByDirection: false,
    searchQuery: "",
    displayMode: loadStringFromStorage(SERIAL_DISPLAY_MODE_KEY, DISPLAY_MODE_VALUES, "text"),
    colorParserConfig: loadColorParserConfig(),
    textViewMode: loadStringFromStorage(SERIAL_TEXT_VIEW_MODE_KEY, TEXT_VIEW_MODE_VALUES, "log"),
    inspectorTab: "connection",

    terminalLines: [],
    terminalActiveLine: "",
    terminalActiveUnits: [],
    terminalCursorColumn: 0,
    terminalPendingEscape: "",
    terminalLineCounter: 0,
    maxTerminalLines: 4000,
    terminalSettings: savedTerminalSettings,

    viewMode: loadStringFromStorage(SERIAL_VIEW_MODE_KEY, VIEW_MODE_VALUES, "text"),
    splitRatio: loadNumberFromStorage(SERIAL_SPLIT_RATIO_KEY, 0.4, (n) => n >= 0 && n <= 1),
    splitOrientation: loadStringFromStorage(SERIAL_SPLIT_ORIENTATION_KEY, SPLIT_ORIENTATION_VALUES, "vertical"),

    sendSettings: savedSendSettings,
    rxFraming: savedRxFraming,

    lineIdCounter: 0,

    // Actions
    setConnected: (connected) => set({ connected }),
    setConnecting: (connecting) => set({ connecting }),
    setRunning: (running) => set({ running, error: null }),
    setError: (error) => set({ error, running: false }),
    setAiBridgeStatus: (aiBridgeStatus) => set({ aiBridgeStatus }),

    setLocalConfig: (config) => {
      set((state) => {
        const newLocal = { ...state.localConfig, ...config };
        saveToStorage(SERIAL_CONFIG_KEY, {
          local: newLocal,
          tcp: state.tcpConfig,
          udp: state.udpConfig,
          simulation: state.simulationConfig,
          activeType: state.activeSourceType,
        });
        return { localConfig: newLocal };
      });
    },

    setTcpConfig: (config) => {
      set((state) => {
        const newTcp = { ...state.tcpConfig, ...config };
        saveToStorage(SERIAL_CONFIG_KEY, {
          local: state.localConfig,
          tcp: newTcp,
          udp: state.udpConfig,
          simulation: state.simulationConfig,
          activeType: state.activeSourceType,
        });
        return { tcpConfig: newTcp };
      });
    },

    setUdpConfig: (config) => {
      set((state) => {
        const newUdp = { ...state.udpConfig, ...config };
        saveToStorage(SERIAL_CONFIG_KEY, {
          local: state.localConfig,
          tcp: state.tcpConfig,
          udp: newUdp,
          simulation: state.simulationConfig,
          activeType: state.activeSourceType,
        });
        return { udpConfig: newUdp };
      });
    },

    setSimulationConfig: (config) => {
      set((state) => {
        const simulation = { ...state.simulationConfig, ...config };
        saveToStorage(SERIAL_CONFIG_KEY, {
          local: state.localConfig,
          tcp: state.tcpConfig,
          udp: state.udpConfig,
          simulation,
          activeType: state.activeSourceType,
        });
        return { simulationConfig: simulation };
      });
    },

    setActiveSourceType: (type) => {
      set((state) => {
        saveToStorage(SERIAL_CONFIG_KEY, {
          local: state.localConfig,
          tcp: state.tcpConfig,
          udp: state.udpConfig,
          simulation: state.simulationConfig,
          activeType: type,
        });
        return { activeSourceType: type };
      });
    },

    getActiveConfig: () => {
      const state = get();
      if (state.activeSourceType === "tcp") {
        return state.tcpConfig;
      }
      if (state.activeSourceType === "udp") {
        return state.udpConfig;
      }
      return state.localConfig;
    },

    addLine: (line) => set((state) => appendSerialLines(state, [line])),

    addLines: (newLines) => set((state) => appendSerialLines(state, newLines)),

    clearLines: () =>
      set({
        lines: [],
        lineIdCounter: 0,
        stats: { bytes_received: 0, bytes_sent: 0 },
        terminalLines: [],
        terminalActiveLine: "",
        terminalActiveUnits: [],
        terminalCursorColumn: 0,
        terminalPendingEscape: "",
        terminalLineCounter: 0,
      }),

    updateStats: (stats) => set({ stats }),

    sessionRecording: false,
    setSessionRecording: (recording) => {
      if (recording) startSessionRecording("serial");
      else stopSessionRecording("serial");
      set({ sessionRecording: recording });
    },

    commitSerialReceiveBatch: (batch) =>
      set((state) => {
        const { telemetryBatch } = batch;
        const detectedChannels = state.chartConfig.channels.length === 0 ? batch.detectedChannels : undefined;
        if (
          !batch.terminalText &&
          batch.lines.length === 0 &&
          telemetryBatch.points.length === 0 &&
          telemetryBatch.success === 0 &&
          telemetryBatch.fail === 0 &&
          batch.bytesReceived === 0 &&
          !detectedChannels
        ) {
          return state;
        }

        const next: Partial<SerialState> = {};
        if (batch.terminalText) Object.assign(next, processTerminalChunk(batch.terminalText, state));
        if (batch.lines.length > 0) Object.assign(next, appendSerialLines(state, batch.lines));

        let chartConfig = state.chartConfig;
        if (detectedChannels) {
          chartConfig = migrateChartConfig({ ...chartConfig, channels: detectedChannels });
          saveToStorage(SERIAL_CHART_CONFIG_KEY, chartConfig);
          next.chartConfig = chartConfig;
        }
        if (telemetryBatch.points.length > 0) {
          // 走与 addChartDataBatch 相同的追加逻辑：滤波 + 触发状态机。
          // 此前这里是单独写的一份，只做了滤波——导致触发捕获在串口实时数据上
          // 完全不生效（实时数据走的是本函数，不是 addChartDataBatch）。
          Object.assign(next, chartSlice.appendSamples(state, telemetryBatch.points, chartConfig));
        }
        if (telemetryBatch.success > 0 || telemetryBatch.fail > 0) {
          next.parseSuccessCount = state.parseSuccessCount + telemetryBatch.success;
          next.parseFailCount = state.parseFailCount + telemetryBatch.fail;
        }
        if (batch.bytesReceived > 0) {
          next.stats = { ...state.stats, bytes_received: state.stats.bytes_received + batch.bytesReceived };
        }
        return next;
      }),

    setAutoScroll: (autoScroll) => set({ autoScroll }),
    setShowTimestamp: (showTimestamp) =>
      set((state) => {
        saveToStorage(SERIAL_TIMESTAMP_SETTINGS_KEY, { show: showTimestamp, format: state.timestampFormat });
        return { showTimestamp };
      }),
    setTimestampFormat: (timestampFormat) =>
      set((state) => {
        const format = timestampFormat.slice(0, 80);
        saveToStorage(SERIAL_TIMESTAMP_SETTINGS_KEY, { show: state.showTimestamp, format });
        return { timestampFormat: format };
      }),
    setShowDirectionPrefix: (showDirectionPrefix) => {
      saveToStorage(SERIAL_SHOW_DIRECTION_PREFIX_KEY, showDirectionPrefix);
      set({ showDirectionPrefix });
    },
    setSplitByDirection: (splitByDirection) => set({ splitByDirection }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setDisplayMode: (displayMode) => {
      saveToStorage(SERIAL_DISPLAY_MODE_KEY, displayMode);
      set({ displayMode });
    },

    setColorParserConfig: (colorParserConfig) => {
      saveColorParserConfig(colorParserConfig);
      set({ colorParserConfig });
    },

    setTextViewMode: (textViewMode) => {
      saveToStorage(SERIAL_TEXT_VIEW_MODE_KEY, textViewMode);
      set({ textViewMode });
    },
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),

    appendTerminalChunk: (text) => set((state) => processTerminalChunk(text, state)),

    clearTerminalBuffer: () =>
      set({
        terminalLines: [],
        terminalActiveLine: "",
        terminalActiveUnits: [],
        terminalCursorColumn: 0,
        terminalPendingEscape: "",
        terminalLineCounter: 0,
      }),

    setTerminalSettings: (settings) => {
      set((state) => {
        const nextSettings = { ...state.terminalSettings, ...settings };
        saveToStorage(SERIAL_TERMINAL_SETTINGS_KEY, nextSettings);
        return { terminalSettings: nextSettings };
      });
    },

    setViewMode: (viewMode) => {
      saveToStorage(SERIAL_VIEW_MODE_KEY, viewMode);
      set({ viewMode });
    },

    setSplitRatio: (splitRatio) => {
      set({ splitRatio });
      clearTimeout(splitRatioSaveTimer);
      splitRatioSaveTimer = setTimeout(() => saveNumberToStorage(SERIAL_SPLIT_RATIO_KEY, splitRatio), 150);
    },

    setSplitOrientation: (splitOrientation) => {
      saveToStorage(SERIAL_SPLIT_ORIENTATION_KEY, splitOrientation);
      set({ splitOrientation });
    },

    setSendSettings: (settings) => {
      set((state) => {
        const newSettings = { ...state.sendSettings, ...settings };
        saveToStorage(SERIAL_SEND_SETTINGS_KEY, newSettings);
        return { sendSettings: newSettings };
      });
    },

    setRxFraming: (settings) => {
      set((state) => {
        const newFraming = { ...state.rxFraming, ...settings };
        saveToStorage(SERIAL_RX_FRAMING_KEY, newFraming);
        return { rxFraming: newFraming };
      });
    },

    reset: () =>
      set({
        connected: false,
        connecting: false,
        running: false,
        error: null,
        lines: [],
        stats: { bytes_received: 0, bytes_sent: 0 },
        lineIdCounter: 0,
        terminalLines: [],
        terminalActiveLine: "",
        terminalActiveUnits: [],
        terminalCursorColumn: 0,
        terminalPendingEscape: "",
        terminalLineCounter: 0,
      }),
  };
});
