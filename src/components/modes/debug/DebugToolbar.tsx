import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUpFromLine, FolderOpen, Pause, Play, Plug, RotateCw, StepBack, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebugStore } from "@/stores/debugStore";
import { useProbeStore } from "@/stores/probeStore";
import { useLogStore } from "@/stores/logStore";
import {
  debugAttach,
  debugClearSymbols,
  debugDetach,
  debugGetCallStack,
  debugHalt,
  debugLoadElf,
  debugReset,
  debugRun,
  debugStepIn,
  debugStepOut,
  debugStepOver,
  type DebugCoreState,
} from "@/lib/debug";
import { ViewMenu } from "./ViewMenu";

interface DebugToolbarProps {
  onResetLayout: () => void;
}

export function DebugToolbar({ onResetLayout }: DebugToolbarProps) {
  const state = useDebugStore((s) => s.state);
  const setDebugState = useDebugStore((s) => s.setState);
  const setLoadedElfPath = useDebugStore((s) => s.setLoadedElfPath);
  const setSymbols = useDebugStore((s) => s.setSymbols);
  const clearSymbolsStore = useDebugStore((s) => s.clearSymbols);
  const setFrames = useDebugStore((s) => s.setFrames);
  const setCurrentFrameId = useDebugStore((s) => s.setCurrentFrameId);

  const selectedProbe = useProbeStore((s) => s.selectedProbe);
  const selectedChipName = useProbeStore((s) => s.selectedChipName);
  const settings = useProbeStore((s) => s.settings);
  const addLog = useLogStore((s) => s.addLog);

  const [busy, setBusy] = useState(false);

  const attached = state !== "detached";
  const halted = state === "halted";
  const running = state === "running";

  // 把 IPC 返回的 core 状态写回 store
  const applyCoreState = (core: DebugCoreState | null, fallback: "attached" = "attached") => {
    if (!core) {
      setDebugState(fallback, null, null);
      return;
    }
    setDebugState(core.state, core.state === "halted" ? "manual" : null, core.pc ?? null);
  };

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    if (label === "attach") useProbeStore.getState().setError(null);
    try {
      await fn();
    } catch (error) {
      addLog("error", `${label}: ${error}`);
      if (label === "attach") useProbeStore.getState().setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleAttach = () =>
    withBusy("attach", async () => {
      if (!selectedProbe) {
        addLog("error", "请先在右侧配置检查器选择调试探针");
        return;
      }
      const chipName = selectedChipName.trim();
      if (!chipName) {
        addLog("error", "请先在右侧配置检查器输入目标芯片型号");
        return;
      }
      addLog("info", `调试 attach (${chipName})...`);
      const status = await debugAttach({
        probe_identifier: selectedProbe.probe_id,
        target: chipName,
        interface_type: settings.interfaceType === "SWD" ? "Swd" : "Jtag",
        clock_speed: settings.clockSpeed,
        connect_mode: settings.connectMode === "Normal" ? "Normal" : "UnderReset",
        halt_after_attach: true,
      });
      applyCoreState(status.core);
      addLog("success", `调试已附加: ${chipName}`);
    });

  const handleDetach = () =>
    withBusy("detach", async () => {
      await debugDetach();
      setDebugState("detached", null, null);
      addLog("info", "调试已断开");
    });

  const handleRun = () =>
    withBusy("run", async () => {
      const core = await debugRun();
      applyCoreState(core);
    });

  // halt 后顺手取一次调用栈（阶段 3 是单帧）
  const refreshCallStack = async () => {
    try {
      const frames = await debugGetCallStack();
      setFrames(frames);
      setCurrentFrameId(frames[0]?.id ?? null);
    } catch (error) {
      addLog("warn", `读调用栈失败: ${error}`);
      setFrames([]);
      setCurrentFrameId(null);
    }
  };

  const handleHalt = () =>
    withBusy("halt", async () => {
      const core = await debugHalt();
      applyCoreState(core);
      addLog("info", `已停止 @ 0x${(core.pc ?? 0).toString(16).padStart(8, "0")}`);
      await refreshCallStack();
    });

  const handleStepIn = () =>
    withBusy("step-in", async () => {
      const core = await debugStepIn();
      setDebugState(core.state, "step", core.pc ?? null);
      await refreshCallStack();
    });

  const handleStepOver = () =>
    withBusy("step-over", async () => {
      const core = await debugStepOver();
      setDebugState(core.state, "step", core.pc ?? null);
      await refreshCallStack();
    });

  const handleStepOut = () =>
    withBusy("step-out", async () => {
      const core = await debugStepOut();
      setDebugState(core.state, "step", core.pc ?? null);
      await refreshCallStack();
    });

  const handleReset = () =>
    withBusy("reset", async () => {
      const core = await debugReset();
      applyCoreState(core);
      addLog("info", "已 reset");
    });

  const handleLoadElf = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: "ELF / AXF", extensions: ["elf", "axf", "out"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string") {
        addLog("info", `加载 ELF: ${selected}`);
        try {
          // 切换到新 ELF：先清掉旧符号，再解析新文件
          await debugClearSymbols();
          clearSymbolsStore();
          const result = await debugLoadElf(selected);
          setLoadedElfPath(result.path);
          setSymbols(result.symbols, result.function_count, result.variable_count);
          addLog("success", `ELF 已加载: ${result.function_count} 个函数 / ${result.variable_count} 个变量`);
        } catch (error) {
          addLog("error", `解析 ELF 失败: ${error}`);
        }
      }
    } catch (error) {
      addLog("error", `选择 ELF 失败: ${error}`);
    }
  };

  return (
    <div className="surface-shell flex items-center gap-2 rounded-[12px] px-2 py-2">
      <Button
        size="sm"
        variant={attached ? "outline" : "default"}
        className="gap-1.5 rounded-full px-3"
        disabled={busy}
        onClick={attached ? handleDetach : handleAttach}
      >
        <Plug className="h-3.5 w-3.5" />
        <span className="text-xs">{attached ? "断开" : "连接"}</span>
      </Button>

      <Button size="sm" variant="outline" className="gap-1.5 rounded-full px-3" disabled={busy} onClick={handleLoadElf}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="text-xs">加载 ELF…</span>
      </Button>

      <div className="mx-1 h-6 w-px bg-border/60" />

      <Button
        size="sm"
        variant="ghost"
        disabled={!halted || busy}
        className="gap-1.5 rounded-full px-3"
        onClick={handleRun}
      >
        <Play className="h-3.5 w-3.5" />
        <span className="text-xs">运行</span>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={!running || busy}
        className="gap-1.5 rounded-full px-3"
        onClick={handleHalt}
      >
        <Pause className="h-3.5 w-3.5" />
        <span className="text-xs">暂停</span>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={!halted || busy}
        className="gap-1.5 rounded-full px-3"
        title="步入：执行一条指令"
        onClick={handleStepIn}
      >
        <StepForward className="h-3.5 w-3.5" />
        <span className="text-xs">步入</span>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={!halted || busy}
        className="gap-1.5 rounded-full px-3"
        title="跨过：单步直到源码行变化（无符号时退化为步入）"
        onClick={handleStepOver}
      >
        <StepBack className="h-3.5 w-3.5 rotate-180" />
        <span className="text-xs">跨过</span>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        disabled={!halted || busy}
        className="gap-1.5 rounded-full px-3"
        title="跳出：在 LR 处下临时硬断点并运行"
        onClick={handleStepOut}
      >
        <ArrowUpFromLine className="h-3.5 w-3.5" />
        <span className="text-xs">跳出</span>
      </Button>

      <div className="mx-1 h-6 w-px bg-border/60" />

      <Button
        size="sm"
        variant="ghost"
        disabled={!attached || busy}
        className="gap-1.5 rounded-full px-3"
        onClick={handleReset}
      >
        <RotateCw className="h-3.5 w-3.5" />
        <span className="text-xs">复位</span>
      </Button>

      <div className="mx-1 h-6 w-px bg-border/60" />

      <ViewMenu onResetLayout={onResetLayout} />
    </div>
  );
}
