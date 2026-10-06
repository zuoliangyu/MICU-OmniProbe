import { create } from "zustand";
import { DEFAULT_AI_BRIDGE_STATUS, type AiBridgeStatus } from "@/lib/aiBridge";

/** AI 数据桥接是全局唯一的本机服务，串口、RTT、蓝牙工作台共用这一份状态。 */
interface AiBridgeState {
  status: AiBridgeStatus;
  setStatus: (status: AiBridgeStatus) => void;
}

export const useAiBridgeStore = create<AiBridgeState>((set) => ({
  status: DEFAULT_AI_BRIDGE_STATUS,
  setStatus: (status) => set({ status }),
}));
