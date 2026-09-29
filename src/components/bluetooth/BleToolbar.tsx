import { useBluetoothStore } from "@/stores/bluetoothStore";
import { useLogStore } from "@/stores/logStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LazyChartConfigDialog } from "@/components/lazyDialogs";
import { SessionRecordControls } from "@/components/rtt/SessionRecordControls";
import { RxFramingSettingsPanel } from "@/components/rtt/RxFramingSettingsPanel";
import { TriggerSettingsPanel } from "@/components/rtt/TriggerSettingsPanel";
import { SignalWorkspaceControls } from "@/components/rtt/SignalWorkspaceControls";
import { detectChartConfig, recentChartSamples } from "@/lib/chartAnalysis";
import {
  Trash2,
  Search,
  FileText,
  Binary,
  SplitSquareHorizontal,
  BarChart3,
  Snowflake,
  Play,
  SlidersHorizontal,
  Sparkles,
  Settings2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useMemo, useState } from "react";
import type { BleLine } from "@/lib/bleTypes";

const NO_SAMPLE_LINES: BleLine[] = [];

export function BleToolbar() {
  const {
    autoScroll,
    searchQuery,
    displayMode,
    viewMode,
    splitOrientation,
    chartConfig,
    chartPaused,
    hasLines,
    setAutoScroll,
    setSearchQuery,
    setDisplayMode,
    setViewMode,
    setSplitOrientation,
    setChartConfig,
    setChartPaused,
    clearLines,
    clearChartData,
    sessionRecording,
    setSessionRecording,
    rxFraming,
    setRxFraming,
    triggeredAt,
    rearmTrigger,
  } = useBluetoothStore(
    useShallow((state) => ({
      autoScroll: state.autoScroll,
      searchQuery: state.searchQuery,
      displayMode: state.displayMode,
      viewMode: state.viewMode,
      splitOrientation: state.splitOrientation,
      chartConfig: state.chartConfig,
      chartPaused: state.chartPaused,
      hasLines: state.lines.length > 0,
      setAutoScroll: state.setAutoScroll,
      setSearchQuery: state.setSearchQuery,
      setDisplayMode: state.setDisplayMode,
      setViewMode: state.setViewMode,
      setSplitOrientation: state.setSplitOrientation,
      setChartConfig: state.setChartConfig,
      setChartPaused: state.setChartPaused,
      clearLines: state.clearLines,
      clearChartData: state.clearChartData,
      sessionRecording: state.sessionRecording,
      setSessionRecording: state.setSessionRecording,
      rxFraming: state.rxFraming,
      setRxFraming: state.setRxFraming,
      triggeredAt: state.triggeredAt,
      rearmTrigger: state.rearmTrigger,
    }))
  );

  const addLog = useLogStore((state) => state.addLog);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chartConfigOpen, setChartConfigOpen] = useState(false);
  // 只有图表配置对话框打开时才需要实时样本；关闭时返回稳定空引用，工具栏不随数据流重渲染。
  const chartSampleLines = useBluetoothStore((state) => (chartConfigOpen ? state.lines : NO_SAMPLE_LINES));
  const chartSamples = useMemo(
    () => recentChartSamples(chartSampleLines, 20, (line) => line.direction === "rx"),
    [chartSampleLines]
  );

  const handleSmartEnableChart = () => {
    const samples = recentChartSamples(
      useBluetoothStore.getState().lines,
      20,
      (line) => line.direction === "rx" && (!chartConfig.framePrefix || line.text.startsWith(chartConfig.framePrefix))
    );
    if (samples.length === 0) {
      addLog("warn", "没有 BLE 数据可分析，请先接收一些数据");
      return;
    }

    const { config, detection: result } = detectChartConfig(chartConfig, samples);
    if (result.confidence < 0.5) {
      addLog("warn", `无法识别 BLE 数据格式（置信度: ${(result.confidence * 100).toFixed(0)}%）`);
      return;
    }

    setChartConfig(config);
    if (viewMode === "text") setViewMode("split");
    addLog("success", result.description);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-border/60 bg-muted/20 px-2 py-2">
      <div className="flex gap-1">
        <Button size="sm" variant={viewMode === "text" ? "secondary" : "ghost"} onClick={() => setViewMode("text")}>
          <FileText className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant={viewMode === "split" ? "secondary" : "ghost"} onClick={() => setViewMode("split")}>
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant={viewMode === "chart" ? "secondary" : "ghost"} onClick={() => setViewMode("chart")}>
          <BarChart3 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative ml-auto w-40 sm:w-48">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-shortcut-search
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索文本"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => {
          clearLines();
          clearChartData();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        清空
      </Button>

      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            更多
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="max-h-[calc(100vh-7rem)] w-[340px] overflow-y-auto overscroll-contain rounded-[24px] border-border/70 p-3"
        >
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">更多操作</div>
              <div className="text-xs text-muted-foreground">分析、布局、显示和配置集中在这里。</div>
            </div>

            <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
              <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">工作流</div>
              <SignalWorkspaceControls
                chartConfig={chartConfig}
                viewMode={viewMode}
                splitOrientation={splitOrientation}
                setChartConfig={setChartConfig}
                setViewMode={setViewMode}
                setSplitOrientation={setSplitOrientation}
                leadingActions={
                  <>
                    <Button
                      size="sm"
                      variant={chartConfig.enabled ? "secondary" : "outline"}
                      onClick={handleSmartEnableChart}
                      disabled={!hasLines}
                      className="gap-1"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      智能启用
                    </Button>
                    <SessionRecordControls
                      source="bluetooth"
                      recording={sessionRecording}
                      setRecording={setSessionRecording}
                      getChartConfig={() => useBluetoothStore.getState().chartConfig}
                      onBeforeReplay={() => useBluetoothStore.getState().clearChartData()}
                      onReplayed={(result, config) => {
                        const state = useBluetoothStore.getState();
                        state.setChartConfig(config);
                        state.addChartDataBatch(result.telemetryBatch.points);
                        state.incrementParseCounts(result.telemetryBatch.success, result.telemetryBatch.fail);
                      }}
                    />
                  </>
                }
                onToggle={(domain, closing) =>
                  addLog(
                    "info",
                    closing
                      ? "已收起 BLE 图表，继续在后台解析数据"
                      : domain === "fft"
                        ? "已打开 BLE FFT 频谱"
                        : "已打开 BLE 时域波形"
                  )
                }
              >
                {viewMode !== "text" && (
                  <Button
                    size="sm"
                    variant={chartPaused ? "secondary" : "outline"}
                    onClick={() => setChartPaused(!chartPaused)}
                    className="gap-1"
                  >
                    {chartPaused ? <Play className="h-3.5 w-3.5" /> : <Snowflake className="h-3.5 w-3.5" />}
                    {chartPaused ? "恢复跟随" : "冻结图表"}
                  </Button>
                )}
              </SignalWorkspaceControls>
            </div>

            <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
              <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">查看</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={displayMode === "hex" ? "secondary" : "outline"}
                  onClick={() => setDisplayMode(displayMode === "text" ? "hex" : "text")}
                  className="gap-1"
                >
                  <Binary className="h-3.5 w-3.5" />
                  {displayMode === "hex" ? "Hex" : "文本"}
                </Button>
                <Button
                  size="sm"
                  variant={autoScroll ? "secondary" : "outline"}
                  onClick={() => setAutoScroll(!autoScroll)}
                >
                  自动滚动
                </Button>
              </div>
            </div>

            <RxFramingSettingsPanel
              framing={rxFraming}
              setFraming={setRxFraming}
              hint="Notify 包若没有换行符，用「空闲超时」或「自定义分隔符」按包断帧。"
            />

            <TriggerSettingsPanel
              chartConfig={chartConfig}
              setChartConfig={setChartConfig}
              triggeredAt={triggeredAt}
              chartPaused={chartPaused}
              rearmTrigger={rearmTrigger}
            />

            <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
              <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">配置</div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => {
                  setMoreOpen(false);
                  setChartConfigOpen(true);
                }}
              >
                <Settings2 className="h-3.5 w-3.5" />
                图表配置
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <LazyChartConfigDialog
        chartConfig={chartConfig}
        setChartConfig={setChartConfig}
        title="BLE 图表配置"
        allowBytesParsers
        samples={chartSamples}
        open={chartConfigOpen}
        onOpenChange={setChartConfigOpen}
        trigger={null}
      />
    </div>
  );
}
