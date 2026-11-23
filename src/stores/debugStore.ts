import { create } from "zustand";
import { debugListBreakpoints, type DebugBreakpointEntry, type DebugFrame, type ElfSymbol } from "@/lib/debug";

export type { DebugBreakpointEntry, DebugFrame };

export type DebugState = "detached" | "attached" | "running" | "halted";

export type HaltReason = "manual" | "breakpoint" | "step" | "exception" | "watchpoint" | "unknown" | null;

const HALT_REASON_TEXT: Record<NonNullable<HaltReason>, string> = {
  manual: "手动",
  breakpoint: "断点",
  step: "单步",
  exception: "异常",
  watchpoint: "观察点",
  unknown: "未知",
};

/** 调试会话状态的展示文字，例如「已停止 · 断点 · 0x08000123」 */
export function formatDebugStatus(state: DebugState, haltReason: HaltReason, pc: number | null): string {
  switch (state) {
    case "detached":
      return "调试未连接";
    case "attached":
      return "调试已附加";
    case "running":
      return "目标运行中";
    case "halted": {
      const reason = haltReason ? HALT_REASON_TEXT[haltReason] : null;
      return `已停止${reason ? ` · ${reason}` : ""}${pc !== null ? ` · 0x${pc.toString(16).padStart(8, "0")}` : ""}`;
    }
  }
}

export type PanelId =
  "symbols" | "source" | "registers" | "locals" | "watch" | "memory" | "callStack" | "breakpoints" | "output";

interface DebugStoreState {
  state: DebugState;
  haltReason: HaltReason;
  pc: number | null;
  // 每停下一次（含单步后仍是 halted）加 1，寄存器 / 变量 / 观察面板据此重新读取
  haltSeq: number;

  loadedElfPath: string | null;
  symbols: ElfSymbol[];
  symbolFunctionCount: number;
  symbolVariableCount: number;

  breakpoints: DebugBreakpointEntry[];
  frames: DebugFrame[];
  currentFrameId: number | null;

  // 视图菜单：每个面板是否在 dock 中可见
  visiblePanels: Record<PanelId, boolean>;

  // Actions
  setState: (state: DebugState, haltReason?: HaltReason, pc?: number | null) => void;
  setLoadedElfPath: (path: string | null) => void;
  setSymbols: (symbols: ElfSymbol[], functionCount: number, variableCount: number) => void;
  clearSymbols: () => void;
  setBreakpoints: (breakpoints: DebugBreakpointEntry[]) => void;
  /** 从后端重新拉取断点列表（含命中次数） */
  refreshBreakpoints: () => Promise<void>;
  setFrames: (frames: DebugFrame[]) => void;
  setCurrentFrameId: (frameId: number | null) => void;
  setPanelVisible: (panel: PanelId, visible: boolean) => void;
  setVisiblePanels: (visiblePanels: Record<PanelId, boolean>) => void;
  resetPanelLayout: () => void;
}

const ALL_PANELS_VISIBLE: Record<PanelId, boolean> = {
  symbols: true,
  source: true,
  registers: true,
  locals: true,
  watch: true,
  memory: true,
  callStack: true,
  breakpoints: true,
  output: true,
};

export const useDebugStore = create<DebugStoreState>((set) => ({
  state: "detached",
  haltReason: null,
  pc: null,
  haltSeq: 0,

  loadedElfPath: null,
  symbols: [],
  symbolFunctionCount: 0,
  symbolVariableCount: 0,

  breakpoints: [],
  frames: [],
  currentFrameId: null,

  visiblePanels: { ...ALL_PANELS_VISIBLE },

  setState: (state, haltReason = null, pc = null) =>
    set((s) => ({ state, haltReason, pc, haltSeq: state === "halted" ? s.haltSeq + 1 : s.haltSeq })),
  setLoadedElfPath: (loadedElfPath) => set({ loadedElfPath }),
  setSymbols: (symbols, functionCount, variableCount) =>
    set({ symbols, symbolFunctionCount: functionCount, symbolVariableCount: variableCount }),
  clearSymbols: () => set({ symbols: [], symbolFunctionCount: 0, symbolVariableCount: 0, loadedElfPath: null }),
  setBreakpoints: (breakpoints) => set({ breakpoints }),
  refreshBreakpoints: async () => set({ breakpoints: await debugListBreakpoints() }),
  setFrames: (frames) => set({ frames }),
  setCurrentFrameId: (currentFrameId) => set({ currentFrameId }),
  setPanelVisible: (panel, visible) => set((s) => ({ visiblePanels: { ...s.visiblePanels, [panel]: visible } })),
  setVisiblePanels: (visiblePanels) => set({ visiblePanels }),
  resetPanelLayout: () => set({ visiblePanels: { ...ALL_PANELS_VISIBLE } }),
}));
