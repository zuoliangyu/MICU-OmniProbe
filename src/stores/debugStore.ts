import { create } from "zustand";
import type { DebugBreakpointEntry, DebugFrame, ElfSymbol } from "@/lib/debug";

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
  setFrames: (frames: DebugFrame[]) => void;
  setCurrentFrameId: (frameId: number | null) => void;
  setPanelVisible: (panel: PanelId, visible: boolean) => void;
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

  loadedElfPath: null,
  symbols: [],
  symbolFunctionCount: 0,
  symbolVariableCount: 0,

  breakpoints: [],
  frames: [],
  currentFrameId: null,

  visiblePanels: { ...ALL_PANELS_VISIBLE },

  setState: (state, haltReason = null, pc = null) => set({ state, haltReason, pc }),
  setLoadedElfPath: (loadedElfPath) => set({ loadedElfPath }),
  setSymbols: (symbols, functionCount, variableCount) =>
    set({ symbols, symbolFunctionCount: functionCount, symbolVariableCount: variableCount }),
  clearSymbols: () => set({ symbols: [], symbolFunctionCount: 0, symbolVariableCount: 0, loadedElfPath: null }),
  setBreakpoints: (breakpoints) => set({ breakpoints }),
  setFrames: (frames) => set({ frames }),
  setCurrentFrameId: (currentFrameId) => set({ currentFrameId }),
  setPanelVisible: (panel, visible) => set((s) => ({ visiblePanels: { ...s.visiblePanels, [panel]: visible } })),
  resetPanelLayout: () => set({ visiblePanels: { ...ALL_PANELS_VISIBLE } }),
}));
