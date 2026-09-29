import { useCallback, useEffect, useMemo, useRef } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ChartWorkspaceAction, ChartWorkspaceReadyPayload, ChartWorkspaceSnapshot } from "@/lib/chartWorkspace";
import {
  CHART_WORKSPACE_ACTION_EVENT,
  CHART_WORKSPACE_READY_EVENT,
  CHART_WORKSPACE_SNAPSHOT_EVENT,
  getChartWorkspaceWindowLabel,
  getChartWorkspaceWindowTitle,
  type ChartWorkspaceSource,
} from "@/lib/chartWorkspace";
import { useChartWorkspaceStore } from "@/stores/chartWorkspaceStore";
import { useLogStore } from "@/stores/logStore";

interface UseChartWorkspaceHostOptions {
  source: ChartWorkspaceSource;
  snapshot: ChartWorkspaceSnapshot;
  setChartPaused: (paused: boolean) => void;
  clearChartData: () => void;
  setChartConfig: (config: ChartWorkspaceSnapshot["chartConfig"]) => void;
}

interface ChartWorkspaceControls {
  openDetachedWindow: () => void | Promise<void>;
  focusDetachedWindow: () => void | Promise<void>;
  restoreInline: () => void | Promise<void>;
}

const chartWorkspaceControls = new Map<ChartWorkspaceSource, ChartWorkspaceControls>();

export function useChartWorkspaceControls(source: ChartWorkspaceSource) {
  const detached = useChartWorkspaceStore((state) => state.detached[source]);
  const invoke = useCallback(
    (action: keyof ChartWorkspaceControls) => chartWorkspaceControls.get(source)?.[action](),
    [source]
  );

  return {
    detached,
    openDetachedWindow: () => invoke("openDetachedWindow"),
    focusDetachedWindow: () => invoke("focusDetachedWindow"),
    restoreInline: () => invoke("restoreInline"),
  };
}

export function useChartWorkspaceHost({
  source,
  snapshot,
  setChartPaused,
  clearChartData,
  setChartConfig,
}: UseChartWorkspaceHostOptions) {
  const detached = useChartWorkspaceStore((state) => state.detached[source]);
  const setDetached = useChartWorkspaceStore((state) => state.setDetached);
  const windowLabel = useMemo(() => getChartWorkspaceWindowLabel(source), [source]);
  const snapshotRef = useRef(snapshot);
  const detachedRef = useRef(detached);
  const openingRef = useRef(false);
  const addLog = useLogStore((state) => state.addLog);

  snapshotRef.current = snapshot;
  detachedRef.current = detached;

  const debugLog = useCallback(
    (message: string) => {
      const text = `[图表窗口:${source}] ${message}`;
      addLog("info", text);
    },
    [addLog, source]
  );

  const debugError = useCallback(
    (message: string) => {
      const text = `[图表窗口:${source}] ${message}`;
      console.error(text);
      addLog("error", text);
    },
    [addLog, source]
  );

  const restoreInline = useCallback(async () => {
    debugLog("请求收回到主窗口");
    setDetached(source, false);
    const popup = await WebviewWindow.getByLabel(windowLabel);
    await popup?.close().catch(() => undefined);
  }, [debugLog, setDetached, source, windowLabel]);

  const openDetachedWindow = useCallback(async () => {
    debugLog(`收到独立窗口请求，目标 label=${windowLabel}`);
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      debugLog("检测到已存在独立窗口，改为唤起现有窗口");
      setDetached(source, true);
      await existing.unminimize().catch(() => undefined);
      await existing.show().catch(() => undefined);
      await existing.setFocus().catch(() => undefined);
      await emitTo(windowLabel, CHART_WORKSPACE_SNAPSHOT_EVENT, snapshotRef.current).catch(() => undefined);
      return;
    }

    openingRef.current = true;
    const popupUrl = new URL(window.location.href);
    popupUrl.searchParams.set("chart_workspace", source);
    popupUrl.hash = "";
    debugLog(`准备创建独立窗口，url=${popupUrl.toString()}`);

    const popup = new WebviewWindow(windowLabel, {
      url: popupUrl.toString(),
      title: getChartWorkspaceWindowTitle(source),
      width: 1440,
      height: 920,
      minWidth: 980,
      minHeight: 680,
      center: true,
      resizable: true,
    });

    void popup.once("tauri://created", async () => {
      openingRef.current = false;
      debugLog("独立窗口创建成功");
      setDetached(source, true);
      await emitTo(windowLabel, CHART_WORKSPACE_SNAPSHOT_EVENT, snapshotRef.current).catch(() => undefined);
    });

    void popup.once("tauri://error", (event) => {
      if (!openingRef.current) {
        return;
      }

      openingRef.current = false;
      setDetached(source, false);
      debugError(`独立窗口创建失败: ${String(event.payload)}`);
    });
  }, [debugError, debugLog, setDetached, source, windowLabel]);

  // 独立窗口的推送节奏使用 chartConfig.updateInterval（配置弹窗“刷新间隔”），
  // 这样用户能自行调节；只依赖这个数值而不是整个 snapshot，避免数据到达
  // （远快于该间隔）就把定时器清空重建，导致画面卡在打开瞬间的第一帧。
  const pushIntervalMs = Math.max(snapshot.chartConfig.updateInterval || 80, 16);

  useEffect(() => {
    if (!detached) return;

    // 快照引用没变（暂停、无新数据）就跳过：完整快照含数千点，序列化 + IPC 并不便宜。
    // 其余推送路径（创建、就绪、唤起）总是强制推送，因此这里只需记住最近一次定时推送的引用。
    let lastSent: ChartWorkspaceSnapshot | null = null;
    const intervalId = window.setInterval(() => {
      const current = snapshotRef.current;
      if (current === lastSent) return;
      lastSent = current;
      void emitTo(windowLabel, CHART_WORKSPACE_SNAPSHOT_EVENT, current).catch(() => undefined);
    }, pushIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [detached, pushIntervalMs, windowLabel]);

  useEffect(() => {
    const readyUnlisten = listen<ChartWorkspaceReadyPayload>(CHART_WORKSPACE_READY_EVENT, ({ payload }) => {
      if (payload.source !== source || !detachedRef.current) return;
      debugLog("独立窗口已就绪，开始同步快照");
      void emitTo(windowLabel, CHART_WORKSPACE_SNAPSHOT_EVENT, snapshotRef.current).catch(() => undefined);
    });

    const actionUnlisten = listen<ChartWorkspaceAction>(CHART_WORKSPACE_ACTION_EVENT, ({ payload }) => {
      if (payload.source !== source) return;

      switch (payload.type) {
        case "set-paused":
          setChartPaused(payload.paused);
          break;
        case "clear-data":
          clearChartData();
          break;
        case "set-config":
          setChartConfig(payload.config);
          break;
        case "restore-inline":
          debugLog("收到独立窗口回收请求");
          void restoreInline();
          break;
      }
    });

    return () => {
      void readyUnlisten.then((fn) => fn());
      void actionUnlisten.then((fn) => fn());
    };
  }, [
    clearChartData,
    detachedRef,
    debugLog,
    restoreInline,
    setChartConfig,
    setChartPaused,
    snapshotRef,
    source,
    windowLabel,
  ]);

  const focusDetachedWindow = useCallback(async () => {
    debugLog("请求定位独立窗口");
    const popup = await WebviewWindow.getByLabel(windowLabel);
    if (!popup) {
      debugError("定位失败，未找到独立窗口实例");
      return;
    }
    await popup.unminimize().catch(() => undefined);
    await popup.show().catch(() => undefined);
    await popup.setFocus().catch(() => undefined);
    await emitTo(windowLabel, CHART_WORKSPACE_SNAPSHOT_EVENT, snapshotRef.current).catch(() => undefined);
  }, [debugError, debugLog, windowLabel]);

  const controls = useMemo(
    () => ({ openDetachedWindow, focusDetachedWindow, restoreInline }),
    [focusDetachedWindow, openDetachedWindow, restoreInline]
  );

  useEffect(() => {
    chartWorkspaceControls.set(source, controls);
    return () => {
      if (chartWorkspaceControls.get(source) === controls) {
        chartWorkspaceControls.delete(source);
      }
    };
  }, [controls, source]);
}

export async function notifyChartWorkspaceReady(source: ChartWorkspaceSource) {
  await emit<ChartWorkspaceReadyPayload>(CHART_WORKSPACE_READY_EVENT, { source });
}

export async function dispatchChartWorkspaceAction(action: ChartWorkspaceAction) {
  await emit<ChartWorkspaceAction>(CHART_WORKSPACE_ACTION_EVENT, action);
}
