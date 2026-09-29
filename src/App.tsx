import { Sidebar } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { ModeSwitch } from "./components/layout/ModeSwitch";
import { WORKSPACE_BY_MODE } from "./components/modes";
import { SerialSidebar } from "./components/serial";
import { BleSidebar } from "./components/bluetooth";
import { UdevPermissionDialog } from "./components/dialogs/UdevPermissionDialog";
import { useEffect, useCallback, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from "react";
import { useLogStore } from "./stores/logStore";
import { useProbeStore } from "./stores/probeStore";
import { useRttStore } from "./stores/rttStore";
import { useSerialStore } from "./stores/serialStore";
import { useBluetoothStore } from "./stores/bluetoothStore";
import { useAppStore } from "./stores/appStore";
import { useFlashStore } from "./stores/flashStore";
import { useIdleTimeout } from "./hooks/useUserActivity";
import { allowImageAsset, disconnect, initPacks } from "./lib/tauri";
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
import type { TelemetryChartState } from "./stores/telemetryChartSlice";

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
  const flashing = useFlashStore((s) => s.flashing);
  const mode = useAppStore((s) => s.mode);
  const WorkspaceView = WORKSPACE_BY_MODE[mode].view;
  const setMode = useAppStore((s) => s.setMode);
  const schemeId = useThemeStore((s) => s.schemeId);
  const backgroundMode = useUiPreferencesStore((s) => s.backgroundMode);
  const backgroundImagePath = useUiPreferencesStore((s) => s.backgroundImagePath);
  const backgroundImageOpacity = useUiPreferencesStore((s) => s.backgroundImageOpacity);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState("");

  // asset 协议默认不放行任何文件：先让后端授权这一张图，再生成 asset:// 地址。
  // 授权失败（文件被删、扩展名不合法等）时退回默认背景。
  useEffect(() => {
    if (backgroundMode !== "custom" || !backgroundImagePath) {
      setBackgroundImageUrl("");
      return;
    }

    let cancelled = false;
    allowImageAsset(backgroundImagePath)
      .then(() => {
        if (!cancelled) setBackgroundImageUrl(convertFileSrc(backgroundImagePath));
      })
      .catch((error) => {
        if (cancelled) return;
        setBackgroundImageUrl("");
        addLog("warn", `背景图片无法加载，已使用默认背景: ${error}`);
      });
    return () => {
      cancelled = true;
    };
  }, [addLog, backgroundMode, backgroundImagePath]);

  useEffect(() => {
    applyThemeSchemeToDocument(schemeId);
  }, [schemeId]);

  // 开发模式 StrictMode 会把 effect 执行两次；启动日志与 Pack 加载只需要一次
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
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

  return (
    <div className="app-shell relative h-screen overflow-hidden text-foreground">
      <ChartWorkspaceHosts />
      <AutoDisconnectGate />
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

/** 图表宿主只需要切片里的这几项；三条来源共用同一个选择器。 */
function selectChartHostState(state: TelemetryChartState) {
  return {
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
  };
}

function useTelemetryChartHost(
  source: ChartWorkspaceSource,
  title: string,
  subtitle: string,
  state: ReturnType<typeof selectChartHostState>
) {
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
  } = state;
  const snapshot = useMemo(
    () => ({
      source,
      title,
      subtitle,
      chartData,
      processedChartData: filterActive ? processedChartData : undefined,
      filterActive,
      chartConfig,
      chartPaused,
      parseSuccessCount,
      parseFailCount,
    }),
    [
      chartConfig,
      chartData,
      chartPaused,
      filterActive,
      parseFailCount,
      parseSuccessCount,
      processedChartData,
      source,
      subtitle,
      title,
    ]
  );

  useChartWorkspaceHost({ source, snapshot, setChartPaused, clearChartData, setChartConfig });
}

function RttChartWorkspaceHost() {
  const state = useRttStore(useShallow(selectChartHostState));
  useTelemetryChartHost("rtt", "RTT 图表工作台", "波形、FFT、字段管理与缓冲控制。", state);
  return null;
}

function SerialChartWorkspaceHost() {
  const state = useSerialStore(useShallow(selectChartHostState));
  useTelemetryChartHost("serial", "串口图表工作台", "波形、FFT、字段管理与缓冲控制。", state);
  return null;
}

function BluetoothChartWorkspaceHost() {
  const state = useBluetoothStore(useShallow(selectChartHostState));
  useTelemetryChartHost("bluetooth", "蓝牙图表工作台", "BLE 波形、FFT、字段管理与缓冲控制。", state);
  return null;
}

/**
 * 自动断开：只在「开启 + 已连接 + RTT 未运行」时挂载空闲计时。
 * 独立成组件是为了让计时与活动检测不牵动 MainApp 整棵树重渲染。
 */
function AutoDisconnectGate() {
  const enabled = useProbeStore((s) => s.autoDisconnect && s.connected);
  const timeoutMs = useProbeStore((s) => s.autoDisconnectTimeout);
  const rttRunning = useRttStore((s) => s.isRunning);
  return enabled && !rttRunning ? <AutoDisconnectWatcher timeoutMs={timeoutMs} /> : null;
}

function AutoDisconnectWatcher({ timeoutMs }: { timeoutMs: number }) {
  const handleIdle = useCallback(() => {
    const { addLog } = useLogStore.getState();
    void (async () => {
      try {
        await disconnect();
        useProbeStore.getState().setConnected(false);
        addLog("info", `检测到 ${timeoutMs / 1000} 秒无操作，已自动断开连接`);
      } catch (error) {
        addLog("error", `自动断开失败: ${error}`);
      }
    })();
  }, [timeoutMs]);

  useIdleTimeout(timeoutMs, handleIdle);
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
