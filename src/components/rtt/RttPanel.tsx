import { useRttStore } from "@/stores/rttStore";
import { RttToolbar } from "./RttToolbar";
import { RttViewer } from "./RttViewer";
import { RttStatusBar } from "./RttStatusBar";
import { RttSendBar } from "./RttSendBar";
import { useProbeStore } from "@/stores/probeStore";
import { RttChartViewer } from "./RttChartViewer";
import { Panel, Group, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import { AlertCircle, FileText, Link, RefreshCw } from "lucide-react";
import { useChartWorkspaceControls } from "@/hooks/useChartWorkspaceHost";
import { useShallow } from "zustand/react/shallow";
import { ChartDetachedPlaceholder, ChartWindowActions } from "./ChartWindowControls";
import { PanelHintCard, PanelShell } from "@/components/layout/PanelShell";

interface RttPanelProps {
  className?: string;
}

export function RttPanel({ className }: RttPanelProps) {
  const {
    error,
    viewMode,
    splitRatio,
    splitOrientation,
    setSplitRatio,
    rttConnected,
    isRunning,
    isStarting,
    recovering,
    hasDownChannels,
    hasLines,
    chartConfig,
  } = useRttStore(
    useShallow((state) => ({
      error: state.error,
      viewMode: state.viewMode,
      splitRatio: state.splitRatio,
      splitOrientation: state.splitOrientation,
      setSplitRatio: state.setSplitRatio,
      rttConnected: state.rttConnected,
      isRunning: state.isRunning,
      isStarting: state.isStarting,
      recovering: state.isRunning && state.phase === "recovering",
      hasDownChannels: state.downChannels.length > 0,
      // 只取布尔值：订阅整个 lines 会让面板随每批数据重渲染
      hasLines: state.lines.length > 0,
      chartConfig: state.chartConfig,
    }))
  );
  const isVerticalSplit = splitOrientation === "vertical";

  const {
    detached: chartDetached,
    openDetachedWindow,
    focusDetachedWindow,
    restoreInline,
  } = useChartWorkspaceControls("rtt");

  const mainConnected = useProbeStore((state) => state.connected);

  const workflowHint = isStarting
    ? {
        icon: RefreshCw,
        title: "正在查找 RTT 控制块",
        description: "自动扫描 RAM 可能需要几秒；改用 ELF 符号或指定地址可以立即定位。",
      }
    : !rttConnected && !mainConnected
      ? {
          icon: Link,
          title: "先连接设备",
          description: "在右侧配置检查器选择探针和芯片后点“连接 RTT”；已在烧录工作台连接时可直接启动。",
        }
      : !isRunning
        ? {
            icon: Link,
            title: "设备已连接，等待启动",
            description: "点击工具栏里的“启动”，开始查找控制块并接收通道数据。",
          }
        : !hasLines
          ? {
              icon: FileText,
              title: "RTT 正在运行，等待目标输出",
              description: "如果固件已经在输出数值流，可以直接切到「波形 / FFT」查看图表。",
            }
          : null;

  // RTT is now independent from main connection
  return (
    <div className={cn("flex h-full flex-col gap-2", className)}>
      {/* 工具栏 */}
      <RttToolbar />

      {/* 文本/分屏视图里日志区的空状态已给出同样的提示，顶部流程提示只在纯图表视图显示 */}
      {workflowHint && viewMode === "chart" && (
        <PanelHintCard icon={workflowHint.icon} title={workflowHint.title} description={workflowHint.description} />
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 rounded-[22px] border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">RTT 工作流出现错误</div>
            <div className="mt-1 text-xs leading-5 text-red-500/90">{error}</div>
          </div>
        </div>
      )}

      {/* 目标复位、重新烧录后的恢复提示 */}
      {recovering && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
          目标已复位或正在更新固件，正在重新查找 RTT 控制块，恢复后自动继续接收。
        </div>
      )}

      {/* 数据显示区 */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "text" ? (
          <PanelShell title="文本区" subtitle="原始 RTT 输出。" badge="Console">
            <RttViewer />
          </PanelShell>
        ) : viewMode === "chart" ? (
          <PanelShell
            title="图表区"
            subtitle="波形、FFT 与趋势图。"
            badge={chartConfig.signalDomain === "fft" ? "FFT" : "Chart"}
            actions={
              <ChartWindowActions
                detached={chartDetached}
                onDetach={openDetachedWindow}
                onFocus={focusDetachedWindow}
                onRestore={restoreInline}
              />
            }
          >
            {chartDetached ? (
              <ChartDetachedPlaceholder onFocus={focusDetachedWindow} onRestore={restoreInline} />
            ) : (
              <RttChartViewer />
            )}
          </PanelShell>
        ) : (
          // 分屏模式
          <Group orientation={splitOrientation}>
            <Panel
              defaultSize={splitRatio * 100}
              minSize={20}
              onResize={(panelSize) => setSplitRatio(panelSize.asPercentage / 100)}
            >
              <div className={cn("h-full min-h-0", isVerticalSplit ? "pb-1" : "pr-1")}>
                <PanelShell title="文本区" subtitle="原始 RTT 输出。" badge="Console">
                  <RttViewer />
                </PanelShell>
              </div>
            </Panel>
            <Separator
              className={cn("bg-border hover:bg-primary/50 transition-colors", isVerticalSplit ? "h-1" : "w-1")}
            />
            <Panel defaultSize={(1 - splitRatio) * 100} minSize={20}>
              <div className={cn("h-full min-h-0", isVerticalSplit ? "pt-1" : "pl-1")}>
                <PanelShell
                  title="图表区"
                  subtitle="波形、FFT 与趋势图。"
                  badge={chartConfig.signalDomain === "fft" ? "FFT" : "Chart"}
                  actions={
                    <ChartWindowActions
                      detached={chartDetached}
                      onDetach={openDetachedWindow}
                      onFocus={focusDetachedWindow}
                      onRestore={restoreInline}
                    />
                  }
                >
                  {chartDetached ? (
                    <ChartDetachedPlaceholder onFocus={focusDetachedWindow} onRestore={restoreInline} />
                  ) : (
                    <RttChartViewer />
                  )}
                </PanelShell>
              </div>
            </Panel>
          </Group>
        )}
      </div>

      {/* 下行发送：仅在固件提供下行通道时显示 */}
      {isRunning && hasDownChannels && viewMode !== "chart" && <RttSendBar />}

      {/* 状态栏 */}
      <RttStatusBar />
    </div>
  );
}
