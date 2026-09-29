import { useCallback, useEffect, useRef } from "react";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useDebugStore, type PanelId } from "@/stores/debugStore";
import { useLogStore } from "@/stores/logStore";
import { debugGetCallStack, debugGetStatus, debugListBreakpoints, debugSetSourceBreakpoint } from "@/lib/debug";
import { DebugToolbar } from "./DebugToolbar";
import { PANEL_ORDER, PANEL_REGISTRY } from "./panels/panelRegistry";

const HALT_POLL_INTERVAL_MS = 300;
const BP_STORAGE_PREFIX = "debug_bp_";

// dockview 要求每个面板组件接受 IDockviewPanelProps；我们的面板内容自己不需要 props，包一层。
const dockviewComponents = Object.fromEntries(
  PANEL_ORDER.map((id) => {
    const { Component } = PANEL_REGISTRY[id];
    const Wrapper = (_props: IDockviewPanelProps) => <Component />;
    Wrapper.displayName = `DockviewPanel(${id})`;
    return [id, Wrapper];
  })
);

// 关闭后重新打开时，落到哪个分区作为新 tab
type ReinsertGroup = "left" | "center" | "right" | "bottom";
const PANEL_REINSERT_GROUP: Record<PanelId, ReinsertGroup> = {
  symbols: "left",
  source: "center",
  registers: "right",
  locals: "right",
  watch: "right",
  memory: "right",
  callStack: "bottom",
  breakpoints: "bottom",
  output: "bottom",
};

function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  const compactLayout = window.matchMedia("(max-width: 1400px)").matches;

  const source = api.addPanel({
    id: "source",
    component: "source",
    title: PANEL_REGISTRY.source.title,
  });
  api.addPanel({
    id: "symbols",
    component: "symbols",
    title: PANEL_REGISTRY.symbols.title,
    position: { direction: "left", referencePanel: source.id },
    initialWidth: compactLayout ? 180 : 220,
  });
  const registers = api.addPanel({
    id: "registers",
    component: "registers",
    title: PANEL_REGISTRY.registers.title,
    position: { direction: "right", referencePanel: source.id },
    initialWidth: compactLayout ? 260 : 340,
  });
  api.addPanel({
    id: "locals",
    component: "locals",
    title: PANEL_REGISTRY.locals.title,
    position: { referencePanel: registers.id },
  });
  api.addPanel({
    id: "watch",
    component: "watch",
    title: PANEL_REGISTRY.watch.title,
    position: { referencePanel: registers.id },
  });
  api.addPanel({
    id: "memory",
    component: "memory",
    title: PANEL_REGISTRY.memory.title,
    position: { referencePanel: registers.id },
  });
  const callStack = api.addPanel({
    id: "callStack",
    component: "callStack",
    title: PANEL_REGISTRY.callStack.title,
    position: { direction: "below", referencePanel: source.id },
    initialHeight: compactLayout ? 180 : 220,
  });
  api.addPanel({
    id: "breakpoints",
    component: "breakpoints",
    title: PANEL_REGISTRY.breakpoints.title,
    position: { referencePanel: callStack.id },
  });
  api.addPanel({
    id: "output",
    component: "output",
    title: PANEL_REGISTRY.output.title,
    position: { referencePanel: callStack.id },
  });

  // 让 source 成为默认激活 tab
  api.getPanel("source")?.api.setActive();
}

function findReferenceForGroup(api: DockviewApi, group: ReinsertGroup): string | undefined {
  // 同分区里随便挑一个还活着的面板作为 referencePanel
  const candidates: Record<ReinsertGroup, PanelId[]> = {
    left: ["symbols"],
    center: ["source"],
    right: ["registers", "locals", "watch", "memory"],
    bottom: ["callStack", "breakpoints", "output"],
  };
  for (const id of candidates[group]) {
    if (api.getPanel(id)) return id;
  }
  return undefined;
}

function reinsertPanel(api: DockviewApi, id: PanelId) {
  if (api.getPanel(id)) return;
  const meta = PANEL_REGISTRY[id];
  const group = PANEL_REINSERT_GROUP[id];
  const ref = findReferenceForGroup(api, group);
  if (ref) {
    api.addPanel({
      id,
      component: id,
      title: meta.title,
      position: { referencePanel: ref },
    });
  } else {
    // 整个目标分区都不存在了，落到当前激活面板旁边
    api.addPanel({ id, component: id, title: meta.title });
  }
}

export function DebugMode() {
  const apiRef = useRef<DockviewApi | null>(null);
  const visiblePanels = useDebugStore((s) => s.visiblePanels);
  const setPanelVisible = useDebugStore((s) => s.setPanelVisible);
  const resetPanelLayout = useDebugStore((s) => s.resetPanelLayout);
  const state = useDebugStore((s) => s.state);
  const setDebugState = useDebugStore((s) => s.setState);
  const setFrames = useDebugStore((s) => s.setFrames);
  const setCurrentFrameId = useDebugStore((s) => s.setCurrentFrameId);
  const loadedElfPath = useDebugStore((s) => s.loadedElfPath);
  const breakpoints = useDebugStore((s) => s.breakpoints);
  const setBreakpoints = useDebugStore((s) => s.setBreakpoints);
  const addLog = useLogStore((s) => s.addLog);

  // 断点持久化：每个 ELF 一份；attached + ELF 都齐了才恢复一次
  const restoredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (state === "detached") {
      restoredKeyRef.current = null;
      return;
    }
    if (!loadedElfPath) return;
    const key = `${BP_STORAGE_PREFIX}${loadedElfPath}`;
    if (restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;

    const raw = localStorage.getItem(key);
    if (!raw) return;
    let saved: { file: string; line: number }[] = [];
    try {
      saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return;
    } catch {
      return;
    }
    if (saved.length === 0) return;

    (async () => {
      let restored = 0;
      for (const item of saved) {
        try {
          await debugSetSourceBreakpoint(item.file, item.line);
          restored += 1;
        } catch {
          // 忽略单个失败：可能行表里这一行已不再存在（重新编译后偏移）
        }
      }
      try {
        const list = await debugListBreakpoints();
        setBreakpoints(list);
      } catch {
        // ignore
      }
      if (restored > 0) {
        addLog("info", `已恢复 ${restored}/${saved.length} 个源码断点`);
      }
    })();
  }, [state, loadedElfPath, addLog, setBreakpoints]);

  // 断点变化 → 落盘（仅源码断点；按地址加的不持久化，避免下次 ELF 重编址错位）
  useEffect(() => {
    if (!loadedElfPath || state === "detached") return;
    const key = `${BP_STORAGE_PREFIX}${loadedElfPath}`;
    const sourceBps = breakpoints
      .filter((b) => b.file && b.line !== null)
      .map((b) => ({ file: b.file as string, line: b.line as number }));
    try {
      localStorage.setItem(key, JSON.stringify(sourceBps));
    } catch {
      // 静默
    }
  }, [breakpoints, loadedElfPath, state]);

  // 运行态轮询：检测断点命中或异步停机
  useEffect(() => {
    if (state !== "running") return;
    let cancelled = false;
    const tick = async () => {
      while (!cancelled) {
        await new Promise((resolve) => setTimeout(resolve, HALT_POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const status = await debugGetStatus();
          if (!status.attached) {
            setDebugState("detached", null, null);
            return;
          }
          if (status.core?.state === "halted") {
            setDebugState("halted", "breakpoint", status.core.pc ?? null);
            try {
              const frames = await debugGetCallStack();
              setFrames(frames);
              setCurrentFrameId(frames[0]?.id ?? null);
            } catch {
              // 忽略，halt 已经记录
            }
            addLog("info", `命中断点 @ 0x${(status.core.pc ?? 0).toString(16).padStart(8, "0")}`);
            return;
          }
        } catch {
          // 单次轮询失败不致命，继续
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [state, setDebugState, setFrames, setCurrentFrameId, addLog]);

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      buildDefaultLayout(event.api);

      // 用户从 dockview tab 上关掉面板 → 同步 store
      const disposable = event.api.onDidRemovePanel((panel) => {
        const id = panel.id as PanelId;
        if (id in PANEL_REGISTRY) {
          setPanelVisible(id, false);
        }
      });

      return () => disposable.dispose();
    },
    [setPanelVisible]
  );

  // 视图菜单勾选 → 同步 dockview
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const id of PANEL_ORDER) {
      const exists = !!api.getPanel(id);
      const shouldExist = visiblePanels[id];
      if (shouldExist && !exists) {
        reinsertPanel(api, id);
      } else if (!shouldExist && exists) {
        const panel = api.getPanel(id);
        if (panel) api.removePanel(panel);
      }
    }
  }, [visiblePanels]);

  const handleResetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    buildDefaultLayout(api);
    resetPanelLayout();
  }, [resetPanelLayout]);

  return (
    <div className="surface-strong flex h-full flex-col gap-2 overflow-hidden rounded-[14px] p-2">
      <DebugToolbar onResetLayout={handleResetLayout} />
      <div className="surface-shell relative flex-1 overflow-hidden rounded-[12px]">
        <DockviewReact
          components={dockviewComponents}
          onReady={handleReady}
          className="dockview-theme-light debug-dock h-full"
        />
      </div>
    </div>
  );
}
