import { create } from "zustand";
import type { ProbeInfo, TargetInfo, ConnectionInfo, ConnectOptions, DeviceSettings } from "@/lib/types";
import { getChipInfo } from "@/lib/tauri";
import { useChipStore } from "./chipStore";

interface ProbeState {
  // 状态
  probes: ProbeInfo[];
  selectedProbe: ProbeInfo | null;
  selectedChipName: string; // 新增：用户输入的芯片名称
  connected: boolean;
  connectionInfo: ConnectionInfo | null;
  targetInfo: TargetInfo | null;
  settings: DeviceSettings;
  loading: boolean;
  error: string | null;

  // 自动断开配置
  autoDisconnect: boolean;
  autoDisconnectTimeout: number; // 毫秒

  // 操作
  setProbes: (probes: ProbeInfo[]) => void;
  selectProbe: (probe: ProbeInfo | null) => void;
  setSelectedChipName: (chipName: string) => void; // 新增
  setConnected: (connected: boolean, info?: ConnectionInfo | null, target?: TargetInfo | null) => void;
  setSettings: (settings: Partial<DeviceSettings>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setAutoDisconnect: (enabled: boolean) => void;
  setAutoDisconnectTimeout: (timeout: number) => void;
  reset: () => void;
}

const defaultSettings: DeviceSettings = {
  interfaceType: "SWD",
  clockSpeed: 1000000, // 1MHz
  connectMode: "Normal",
  resetMode: "Software",
  voltage: 3.3,
};

export const useProbeStore = create<ProbeState>((set) => ({
  probes: [],
  selectedProbe: null,
  selectedChipName: "", // 新增：初始为空
  connected: false,
  connectionInfo: null,
  targetInfo: null,
  settings: defaultSettings,
  loading: false,
  error: null,
  autoDisconnect: true, // 默认启用
  autoDisconnectTimeout: 10000, // 默认10秒

  setProbes: (probes) => set({ probes }),

  selectProbe: (probe) => set({ selectedProbe: probe }),

  setSelectedChipName: (selectedChipName) => set({ selectedChipName }), // 新增

  setConnected: (connected, info = null, target = null) => set({ connected, connectionInfo: info, targetInfo: target }),

  setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  setAutoDisconnect: (autoDisconnect) => set({ autoDisconnect }),

  setAutoDisconnectTimeout: (autoDisconnectTimeout) => set({ autoDisconnectTimeout }),

  reset: () =>
    set({
      selectedProbe: null,
      connected: false,
      connectionInfo: null,
      targetInfo: null,
      loading: false,
      error: null,
    }),
}));

/** 由探针、芯片与接口设置组装烧录连接参数（侧栏「连接设备」与「解锁芯片」共用） */
export function buildConnectOptions(probe: ProbeInfo, target: string, settings: DeviceSettings): ConnectOptions {
  return {
    probe_identifier: probe.probe_id,
    target,
    interface_type: settings.interfaceType === "SWD" ? "Swd" : "Jtag",
    clock_speed: settings.clockSpeed,
    connect_mode: settings.connectMode === "Normal" ? "Normal" : "UnderReset",
  };
}

/**
 * 选定目标芯片：同步芯片选择、搜索框与 probeStore，并加载芯片信息（侧栏选择与打开项目共用）。
 * 芯片信息加载失败时抛出错误，由调用方记录日志。
 */
export async function selectTargetChip(chipName: string): Promise<void> {
  const chip = useChipStore.getState();
  chip.selectChip(chipName);
  chip.setSearchQuery(chipName);
  chip.setSearchResults([]);
  useProbeStore.getState().setSelectedChipName(chipName);
  chip.setChipInfo(await getChipInfo(chipName));
}
