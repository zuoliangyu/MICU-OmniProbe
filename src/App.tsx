import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { ModeSwitch } from "./components/layout/ModeSwitch";
import { WORKSPACE_BY_MODE } from "./components/modes";
import { SerialSidebar } from "./components/serial";
import { BleSidebar } from "./components/bluetooth";
import { UdevPermissionDialog } from "./components/dialogs/UdevPermissionDialog";
import { useEffect, useCallback, useMemo, useState, lazy, Suspense, type CSSProperties } from "react";
import { useLogStore } from "./stores/logStore";
import { useProbeStore } from "./stores/probeStore";
import { useRttStore } from "./stores/rttStore";
import { useSerialStore } from "./stores/serialStore";
import { useBluetoothStore } from "./stores/bluetoothStore";
import { useAppStore } from "./stores/appStore";
import { useFlashStore } from "./stores/flashStore";
import { useUserActivity } from "./hooks/useUserActivity";
import { disconnect, initPacks } from "./lib/tauri";
import { applyThemeSchemeToDocument } from "./lib/themeSchemes";
import { useThemeStore } from "./stores/themeStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useUiPreferencesStore } from "./stores/uiPreferencesStore";
// 弹出图表窗口的整页组件只在带 ?chart_workspace= 的独立窗口里用到，
// 主窗口永远不渲染它。静态 import 会把 recharts 拉进首屏 chunk，故改为按需加载。
const ChartWorkspaceWindowPage = lazy(() =>
  import("./components/rtt/ChartWorkspaceWindowPage").then((m) => ({ default: m.ChartWorkspaceWindowPage }))
);
import { isChartWorkspaceSource, type ChartWorkspaceSource } from "./lib/chartWorkspace";
import { Cpu } from "lucide-react";
import { useRttEvents } from "./hooks/useRttEvents";
import { useSerialEvents } from "./hooks/useSerialEvents";
import { useBluetoothEvents } from "./hooks/useBluetoothEvents";
import { useChartWorkspaceHost } from "./hooks/useChartWorkspaceHost";
import { useShallow } from "zustand/react/shallow";

function App() {
  const popupSource = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("chart_workspace");
    return isChartWorkspaceSource(value) ? value : null;
  }, []);

  if (popupSource) {
    return <ChartWorkspacePopupApp source={popupSource} />;
  }

  return <MainApp />;
}

function MainApp() {
  useRttEvents();
  useSerialEvents();
  useBluetoothEvents();

  const [inspectorOpen, setInspectorOpen] = useState(() => !window.matchMedia("(max-width: 1100px)").matches);
  const [inspectorWidth, setInspectorWidth] = useState(288);
  const addLog = useLogStore((state) => state.addLog);
  const connected = useProbeStore((s) => s.connected);
  const autoDisconnect = useProbeStore((s) => s.autoDisconnect);
  const autoDisconnectTimeout = useProbeStore((s) => s.autoDisconnectTimeout);
  const setConnected = useProbeStore((s) => s.setConnected);
  const rttRunning = useRttStore((s) => s.isRunning);
  const flashing = useFlashStore((s) => s.flashing);
  const mode = useAppStore((s) => s.mode);
  const WorkspaceView = WORKSPACE_BY_MODE[mode].view;
  const setMode = useAppStore((s) => s.setMode);
  const schemeId = useThemeStore((s) => s.schemeId);
  const backgroundMode = useUiPreferencesStore((s) => s.backgroundMode);
  const backgroundImagePath = useUiPreferencesStore((s) => s.backgroundImagePath);
  const backgroundImageOpacity = useUiPreferencesStore((s) => s.backgroundImageOpacity);
  const { isActive, timeRemainingSeconds } = useUserActivity(autoDisconnectTimeout);
  const backgroundImageUrl = useMemo(() => {
    if (backgroundMode !== "custom" || !backgroundImagePath) {
      return "";
    }

    return convertFileSrc(backgroundImagePath);
  }, [backgroundMode, backgroundImagePath]);

  useEffect(() => {
    applyThemeSchemeToDocument(schemeId);
  }, [schemeId]);

  useEffect(() => {
    addLog("info", "MICU-OmniProbe 已启动");
    addLog("info", "等待连接调试探针...");

    // Initialize: load imported Packs
    initPacks()
      .then((count) => {
        if (count > 0) {
          addLog("success", `已加载 ${count} 个芯片定义从 CMSIS-Pack`);
        }
      })
      .catch((error) => {
        addLog("warn", `加载 Pack 失败: ${error}`);
      });
  }, [addLog]);

  // 全局快捷键
  // Ctrl+1..6: 切换常用工作台
  // Ctrl+L:    清空当前模式数据
  // Ctrl+F:    聚焦当前模式搜索框
  // Space:     在 RTT 模式下切换图表暂停
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isInInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (e.ctrlKey && e.key === "1") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("flash");
        return;
      }

      if (e.ctrlKey && e.key === "2") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("rtt");
        return;
      }

      if (e.ctrlKey && e.key === "3") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("serial");
        return;
      }

      if (e.ctrlKey && e.key === "4") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("bluetooth");
        return;
      }

      if (e.ctrlKey && e.key === "5") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("debug");
        return;
      }

      if (e.ctrlKey && e.key === "6") {
        if (isInInput) return;
        e.preventDefault();
        if (!flashing) setMode("log-analysis");
        return;
      }

      // Ctrl+F：聚焦当前模式搜索框（即使在某些 input 中也允许，方便切焦点）
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        const target = document.querySelector<HTMLInputElement>("[data-shortcut-search]:not([disabled])");
        if (target) {
          e.preventDefault();
          target.focus();
          target.select();
        }
        return;
      }

      if (isInInput) return;

      // Ctrl+L：清空当前模式数据
      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (mode === "rtt") {
          useRttStore.getState().clearLines();
        } else if (mode === "serial") {
          const serialState = useSerialStore.getState();
          serialState.clearLines();
          serialState.clearTerminalBuffer();
        } else if (mode === "bluetooth") {
          const bleState = useBluetoothStore.getState();
          bleState.clearLines();
          bleState.clearChartData();
        }
        return;
      }

      // Space：在 RTT 模式下切换图表暂停
      if (e.key === " " && mode === "rtt") {
        e.preventDefault();
        const rttState = useRttStore.getState();
        rttState.setChartPaused(!rttState.chartPaused);
        return;
      }
    },
    [flashing, mode, setMode]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const focusInspector = () => {
      setInspectorOpen(true);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".ide-inspector input, .ide-inspector button")?.focus();
      });
    };

    window.addEventListener("focus-inspector", focusInspector);
    return () => window.removeEventListener("focus-inspector", focusInspector);
  }, []);

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 1100px)");
    const collapseInspector = (event: MediaQueryListEvent) => {
      if (event.matches) setInspectorOpen(false);
    };

    compactLayout.addEventListener("change", collapseInspector);
    return () => compactLayout.removeEventListener("change", collapseInspector);
  }, []);

  // Auto-disconnect logic
  useEffect(() => {
    // If auto-disconnect is disabled, not connected, or RTT is running, don't auto-disconnect
    if (!autoDisconnect || !connected || rttRunning) {
      return;
    }

    // If user is inactive, perform auto-disconnect
    if (!isActive) {
      void (async () => {
        try {
          await disconnect();
          setConnected(false);
          addLog("info", `检测到 ${autoDisconnectTimeout / 1000} 秒无操作，已自动断开连接`);
        } catch (error) {
          addLog("error", `自动断开失败: ${error}`);
        }
      })();
    }
  }, [addLog, autoDisconnect, autoDisconnectTimeout, connected, isActive, rttRunning, setConnected]);

  // Show countdown hint (last 5 seconds)
  useEffect(() => {
    if (autoDisconnect && connected && !rttRunning && timeRemainingSeconds > 0 && timeRemainingSeconds <= 5) {
      // Can add countdown UI hint here
      // e.g.: show a toast or display countdown in TopBar
    }
  }, [autoDisconnect, connected, rttRunning, timeRemainingSeconds]);

  return (
    <div className="app-shell relative h-screen overflow-hidden text-foreground">
      <ChartWorkspaceHosts />
      {backgroundImageUrl && (
        <div
          className="app-background-image"
          style={{
            backgroundImage: `url("${backgroundImageUrl}")`,
            opacity: backgroundImageOpacity,
          }}
        />
      )}

      <div className="ide-workbench relative z-[1] grid h-full grid-cols-[72px_minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)] gap-2 overflow-hidden p-3">
        <aside className="surface-shell row-span-2 flex min-h-0 flex-col items-center rounded-[14px] p-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(73,110,214,0.22)]">
            <Cpu className="h-4 w-4" />
          </div>
          <ModeSwitch orientation="vertical" className="mt-2" />
        </aside>

        <TopBar inspectorOpen={inspectorOpen} onToggleInspector={() => setInspectorOpen((open) => !open)} />

        <div
          className={`ide-workspace-grid grid min-h-0 overflow-hidden ${inspectorOpen && mode !== "control-panel" && mode !== "log-analysis" ? "inspector-open" : ""}`}
          style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}
        >
          <div className="mode-stack relative min-w-0 overflow-hidden rounded-[14px]">
            <div key={mode} className="mode-stage h-full">
              <Suspense fallback={<WorkspaceLoading />}>
                <WorkspaceView />
              </Suspense>
            </div>
          </div>

          {inspectorOpen && mode !== "control-panel" && mode !== "log-analysis" && (
            <>
              <button
                type="button"
                aria-label="调整配置检查器宽度"
                className="ide-inspector-resizer group flex h-full cursor-col-resize items-center justify-center bg-transparent"
                onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    setInspectorWidth(Math.min(440, Math.max(240, window.innerWidth - event.clientX - 12)));
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setInspectorWidth((width) =>
                      Math.min(440, Math.max(240, width + (event.key === "ArrowLeft" ? 16 : -16)))
                    );
                  }
                }}
              >
                <span className="h-10 w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
              </button>
              <div className="ide-inspector min-h-0 min-w-0 overflow-hidden">
                {mode === "serial" ? <SerialSidebar /> : mode === "bluetooth" ? <BleSidebar /> : <Sidebar />}
              </div>
            </>
          )}
        </div>
      </div>

      {/* USB 权限检查对话框 (仅 Linux) */}
      <UdevPermissionDialog />
    </div>
  );
}

/** 工作台按需加载时的占位。本地磁盘读取通常几十毫秒内完成，保持极简避免闪屏。 */
function WorkspaceLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Cpu className="h-5 w-5 animate-pulse text-[var(--text-muted)]" aria-label="加载工作台" />
    </div>
  );
}

function ChartWorkspaceHosts() {
  return (
    <>
      <RttChartWorkspaceHost />
      <SerialChartWorkspaceHost />
      <BluetoothChartWorkspaceHost />
    </>
  );
}

function RttChartWorkspaceHost() {
  const {
    chartData,
    processedChartData,
    filterActive,
    chartConfig,
    chartPaused,
    parseSuccessCount,
    parseFailCount,
    setChartPaused,
    clearChartData,
    setChartConfig,
  } = useRttStore(
    useShallow((state) => ({
      chartData: state.chartData,
      processedChartData: state.processedChartData,
      filterActive: state.filterActive,
      chartConfig: state.chartConfig,
      chartPaused: state.chartPaused,
      parseSuccessCount: state.parseSuccessCount,
      parseFailCount: state.parseFailCount,
      setChartPaused: state.setChartPaused,
      clearChartData: state.clearChartData,
      setChartConfig: state.setChartConfig,
    }))
  );
  const snapshot = useMemo(
    () => ({
      source: "rtt" as const,
      title: "RTT 图表工作台",
      subtitle: "波形、FFT、字段管理与缓冲控制。",
      chartData,
      processedChartData: filterActive ? processedChartData : undefined,
      filterActive,
      chartConfig,
      chartPaused,
      parseSuccessCount,
      parseFailCount,
    }),
    [chartConfig, chartData, chartPaused, filterActive, parseFailCount, parseSuccessCount, processedChartData]
  );

  useChartWorkspaceHost({ source: "rtt", snapshot, setChartPaused, clearChartData, setChartConfig });
  return null;
}

function SerialChartWorkspaceHost() {
  const {
    chartData,
    processedChartData,
    filterActive,
    chartConfig,
    chartPaused,
    parseSuccessCount,
    parseFailCount,
    setChartPaused,
    clearChartData,
    setChartConfig,
  } = useSerialStore(
    useShallow((state) => ({
      chartData: state.chartData,
      processedChartData: state.processedChartData,
      filterActive: state.filterActive,
      chartConfig: state.chartConfig,
      chartPaused: state.chartPaused,
      parseSuccessCount: state.parseSuccessCount,
      parseFailCount: state.parseFailCount,
      setChartPaused: state.setChartPaused,
      clearChartData: state.clearChartData,
      setChartConfig: state.setChartConfig,
    }))
  );
  const snapshot = useMemo(
    () => ({
      source: "serial" as const,
      title: "串口图表工作台",
      subtitle: "波形、FFT、字段管理与缓冲控制。",
      chartData,
      processedChartData: filterActive ? processedChartData : undefined,
      filterActive,
      chartConfig,
      chartPaused,
      parseSuccessCount,
      parseFailCount,
    }),
    [chartConfig, chartData, chartPaused, filterActive, parseFailCount, parseSuccessCount, processedChartData]
  );

  useChartWorkspaceHost({ source: "serial", snapshot, setChartPaused, clearChartData, setChartConfig });
  return null;
}

function BluetoothChartWorkspaceHost() {
  const {
    chartData,
    processedChartData,
    filterActive,
    chartConfig,
    chartPaused,
    parseSuccessCount,
    parseFailCount,
    setChartPaused,
    clearChartData,
    setChartConfig,
  } = useBluetoothStore(
    useShallow((state) => ({
      chartData: state.chartData,
      processedChartData: state.processedChartData,
      filterActive: state.filterActive,
      chartConfig: state.chartConfig,
      chartPaused: state.chartPaused,
      parseSuccessCount: state.parseSuccessCount,
      parseFailCount: state.parseFailCount,
      setChartPaused: state.setChartPaused,
      clearChartData: state.clearChartData,
      setChartConfig: state.setChartConfig,
    }))
  );
  const snapshot = useMemo(
    () => ({
      source: "bluetooth" as const,
      title: "蓝牙图表工作台",
      subtitle: "BLE 波形、FFT、字段管理与缓冲控制。",
      chartData,
      processedChartData: filterActive ? processedChartData : undefined,
      filterActive,
      chartConfig,
      chartPaused,
      parseSuccessCount,
      parseFailCount,
    }),
    [chartConfig, chartData, chartPaused, filterActive, parseFailCount, parseSuccessCount, processedChartData]
  );

  useChartWorkspaceHost({ source: "bluetooth", snapshot, setChartPaused, clearChartData, setChartConfig });
  return null;
}

function ChartWorkspacePopupApp({ source }: { source: ChartWorkspaceSource }) {
  const schemeId = useThemeStore((s) => s.schemeId);

  useEffect(() => {
    applyThemeSchemeToDocument(schemeId);
  }, [schemeId]);

  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <ChartWorkspaceWindowPage source={source} />
    </Suspense>
  );
}

export default App;
