import { useBluetoothStore } from "@/stores/bluetoothStore";
import { BleToolbar } from "./BleToolbar";
import { BleViewer } from "./BleViewer";
import { BleSendBar } from "./BleSendBar";
import { ChartViewer } from "@/components/rtt/ChartViewer";
import { Panel, Group, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import { Activity, AlertCircle, FileText, Plug2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShallow } from "zustand/react/shallow";
import { useChartWorkspaceControls } from "@/hooks/useChartWorkspaceHost";
import { ChartDetachedPlaceholder, ChartWindowActions } from "@/components/rtt/ChartWindowControls";
import { PanelHintCard, PanelShell } from "@/components/layout/PanelShell";

interface BluetoothPanelProps {
  className?: string;
}

function BleChartViewer() {
  const {
    chartData,
    processedChartData,
    filterActive,
    chartConfig,
    chartPaused,
    triggeredAt,
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
      triggeredAt: state.triggeredAt,
      parseSuccessCount: state.parseSuccessCount,
      parseFailCount: state.parseFailCount,
      setChartPaused: state.setChartPaused,
      clearChartData: state.clearChartData,
      setChartConfig: state.setChartConfig,
    }))
  );

  return (
    <ChartViewer
      chartData={chartData}
      processedData={processedChartData}
      filterActive={filterActive}
      chartConfig={chartConfig}
      chartPaused={chartPaused}
      parseSuccessCount={parseSuccessCount}
      parseFailCount={parseFailCount}
      setChartPaused={setChartPaused}
      clearChartData={clearChartData}
      setChartConfig={setChartConfig}
      triggeredAt={triggeredAt}
    />
  );
}

export function BluetoothPanel({ className }: BluetoothPanelProps) {
  const {
    connectionMode,
    error,
    viewMode,
    splitRatio,
    splitOrientation,
    setSplitRatio,
    connected,
    running,
    hasLines,
    chartConfig,
  } = useBluetoothStore(
    useShallow((state) => ({
      connectionMode: state.connectionMode,
      error: state.error,
      viewMode: state.viewMode,
      splitRatio: state.splitRatio,
      splitOrientation: state.splitOrientation,
      setSplitRatio: state.setSplitRatio,
      connected: state.connected,
      running: state.running,
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
  } = useChartWorkspaceControls("bluetooth");

  if (connectionMode === "spp") {
    return (
      <div className={cn("flex h-full flex-col gap-2", className)}>
        <SppGuidanceCard />
      </div>
    );
  }

  const workflowHint = !connected
    ? {
        icon: Activity,
        title: "先扫描并连接 BLE 设备",
        description: "在右侧配置检查器点击「扫描」，选中目标设备进行连接。",
      }
    : !running
      ? {
          icon: Activity,
          title: "已连接 BLE 设备，等待开始接收",
          description: "在右侧配置检查器选择 Notify 特征值并点击「开始接收」。NUS 设备会自动识别。",
        }
      : !hasLines
        ? {
            icon: FileText,
            title: "已订阅 Notify，等待数据流入",
            description: "收到结构化数值后可直接切到「波形 / FFT」，或保留分屏观察。",
          }
        : null;

  return (
    <div className={cn("flex h-full flex-col gap-2", className)}>
      <BleToolbar />

      {/* 文本/分屏视图里日志区的空状态已给出同样的提示，顶部流程提示只在纯图表视图显示 */}
      {workflowHint && viewMode === "chart" && (
        <PanelHintCard icon={workflowHint.icon} title={workflowHint.title} description={workflowHint.description} />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-[22px] border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">BLE 工作流出现错误</div>
            <div className="mt-1 text-xs leading-5 text-red-500/90">{error}</div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {viewMode === "text" ? (
          <PanelShell title="文本区" subtitle="原始 BLE 数据。" badge="Console">
            <BleViewer />
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
              <BleChartViewer />
            )}
          </PanelShell>
        ) : (
          <Group orientation={splitOrientation}>
            <Panel
              defaultSize={splitRatio * 100}
              minSize={20}
              onResize={(size) => setSplitRatio(size.asPercentage / 100)}
            >
              <div className={cn("h-full min-h-0", isVerticalSplit ? "pb-1" : "pr-1")}>
                <PanelShell title="文本区" subtitle="原始 BLE 数据。" badge="Console">
                  <BleViewer />
                </PanelShell>
              </div>
            </Panel>
            <Separator
              className={cn("bg-border transition-colors hover:bg-primary/50", isVerticalSplit ? "h-1" : "w-1")}
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
                    <BleChartViewer />
                  )}
                </PanelShell>
              </div>
            </Panel>
          </Group>
        )}
      </div>

      <BleSendBar />
    </div>
  );
}

function SppGuidanceCard() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto rounded-[28px] border border-border/60 bg-white/75 p-8 shadow-[0_12px_26px_rgba(73,93,142,0.08)] backdrop-blur">
      <div className="max-w-xl space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Plug2 className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold text-foreground">经典蓝牙 SPP 模式</div>
        <p className="text-sm leading-6 text-muted-foreground">
          经典蓝牙 SPP 设备配对后会被操作系统映射成 <span className="font-medium text-foreground">虚拟串口</span>，因此
          MICU-OmniProbe 直接在「串口模式」里使用，终端、收发分屏、波形、HEX、发送历史都正常可用。
        </p>
        <div className="rounded-[18px] border border-border/70 bg-white/55 px-4 py-3 text-left text-sm leading-6 text-foreground">
          <div className="font-medium">使用步骤</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>在系统蓝牙设置中和目标设备完成配对</li>
            <li>回到本页，点右侧「SPP 虚拟串口」区域的「刷新」</li>
            <li>点击对应端口右侧「连接」，会自动跳转到串口工作台并开始接收</li>
          </ol>
        </div>
        <Button variant="outline" onClick={() => window.dispatchEvent(new Event("focus-inspector"))}>
          打开 SPP 配置
        </Button>
        <p className="text-xs text-muted-foreground">
          Windows 一般会显示成「Standard Serial over Bluetooth link (COMxx)」；Linux 用 <code>rfcomm bind</code>{" "}
          后会得到 <code>/dev/rfcommN</code>。
        </p>
      </div>
    </div>
  );
}
