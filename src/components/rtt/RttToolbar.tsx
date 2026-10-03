import { useRttStore } from "@/stores/rttStore";
import type { RttLine } from "@/lib/types";
import { SessionRecordControls } from "./SessionRecordControls";
import { RxFramingSettingsPanel } from "./RxFramingSettingsPanel";
import { TriggerSettingsPanel } from "./TriggerSettingsPanel";
import { useLogStore } from "@/stores/logStore";
import { useProbeStore } from "@/stores/probeStore";
import { useChipStore } from "@/stores/chipStore";
import { startRtt, stopRtt, connectRtt, disconnectRtt, getRttConnectionStatus } from "@/lib/tauri";
import { buildRttStartOptions, formatHexAddress } from "@/lib/rttStart";
import { RttStartSettingsPanel } from "./RttStartSettingsPanel";
import { Button } from "@/components/ui/button";
import { DataViewSwitch } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Play,
  Square,
  Pause,
  RotateCcw,
  Trash2,
  Download,
  Copy,
  Search,
  Binary,
  FileText,
  Link,
  Unlink,
  Sparkles,
  SlidersHorizontal,
  Settings2,
} from "lucide-react";
import { ColorSettingsDialog } from "./ColorSettingsDialog";
import { LazyChartConfigDialog } from "@/components/lazyDialogs";
import { RttIntegrationGuideDialog } from "./RttIntegrationGuideDialog";
import { useEffect, useMemo, useState } from "react";
import { detectChartConfig, recentChartSamples } from "@/lib/chartAnalysis";
import { exportRttLinesAsTxt, exportRttLinesAsCsv } from "@/lib/exporters";
import { copyAllLines, formatRttLineForCopy } from "@/lib/viewerCopy";
import { useShallow } from "zustand/react/shallow";
import { SignalWorkspaceControls } from "./SignalWorkspaceControls";

/** 稳定的空数组引用：配置对话框关闭时用它替代 lines，避免订阅到每帧都换 identity 的大数组。 */
const NO_SAMPLE_LINES: RttLine[] = [];

export function RttToolbar() {
  const {
    rttConnected,
    rttConnecting,
    isRunning,
    isPaused,
    autoScroll,
    searchQuery: rttSearchQuery, // 重命名避免冲突
    displayMode,
    viewMode,
    splitOrientation,
    isStarting,
    pausedBacklog,
    chartConfig,
    setRttConnected,
    setRttConnecting,
    setRunning,
    setStarting,
    setPaused,
    setAutoScroll,
    setSearchQuery,
    setDisplayMode,
    setViewMode,
    setSplitOrientation,
    clearLines,
    setChartConfig,
    sessionRecording,
    setSessionRecording,
    rxFraming,
    setRxFraming,
    chartPaused,
    triggeredAt,
    rearmTrigger,
  } = useRttStore(
    useShallow((state) => ({
      rttConnected: state.rttConnected,
      rttConnecting: state.rttConnecting,
      isRunning: state.isRunning,
      isPaused: state.isPaused,
      autoScroll: state.autoScroll,
      searchQuery: state.searchQuery,
      displayMode: state.displayMode,
      viewMode: state.viewMode,
      splitOrientation: state.splitOrientation,
      isStarting: state.isStarting,
      pausedBacklog: state.pausedBacklog,
      chartConfig: state.chartConfig,
      setRttConnected: state.setRttConnected,
      setRttConnecting: state.setRttConnecting,
      setRunning: state.setRunning,
      setStarting: state.setStarting,
      setPaused: state.setPaused,
      setAutoScroll: state.setAutoScroll,
      setSearchQuery: state.setSearchQuery,
      setDisplayMode: state.setDisplayMode,
      setViewMode: state.setViewMode,
      setSplitOrientation: state.setSplitOrientation,
      clearLines: state.clearLines,
      setChartConfig: state.setChartConfig,
      sessionRecording: state.sessionRecording,
      setSessionRecording: state.setSessionRecording,
      rxFraming: state.rxFraming,
      setRxFraming: state.setRxFraming,
      chartPaused: state.chartPaused,
      triggeredAt: state.triggeredAt,
      rearmTrigger: state.rearmTrigger,
    }))
  );

  const addLog = useLogStore((state) => state.addLog);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chartConfigOpen, setChartConfigOpen] = useState(false);

  // 渲染时只需要「有没有数据」；订阅整个 lines 会让工具栏每帧重渲染一次。
  const lineCount = useRttStore((state) => state.lines.length);
  // 仅在图表配置对话框打开时才需要实时样本，关闭时用稳定空引用。
  const chartSampleLines = useRttStore((state) => (chartConfigOpen ? state.lines : NO_SAMPLE_LINES));
  const chartSamples = useMemo(() => recentChartSamples(chartSampleLines), [chartSampleLines]);
  const { selectedProbe, selectedChipName, settings, mainConnected, mainCoreCount } = useProbeStore(
    useShallow((state) => ({
      selectedProbe: state.selectedProbe,
      selectedChipName: state.selectedChipName,
      settings: state.settings,
      mainConnected: state.connected,
      mainCoreCount: state.targetInfo?.core_count ?? 1,
    }))
  );
  // 独立 RTT 连接的核心数；未单独连接时借用烧录连接
  const [rttCoreCount, setRttCoreCount] = useState(1);
  const coreCount = rttConnected ? rttCoreCount : mainCoreCount;
  const canStart = rttConnected || mainConnected;
  const chipSearchQuery = useChipStore((state) => state.searchQuery);

  // 检查 RTT 连接状态
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getRttConnectionStatus();
        setRttConnected(status.connected);
      } catch {
        setRttConnected(false);
      }
    };
    checkStatus();
  }, [setRttConnected]);

  // RTT 连接（使用右侧配置检查器的全局配置）
  const handleRttConnect = async () => {
    if (!selectedProbe) {
      addLog("error", "请先在右侧配置检查器选择调试探针");
      return;
    }

    // 优先使用 selectedChipName，如果为空则使用 chipSearchQuery（输入框的值）
    const chipName = selectedChipName || chipSearchQuery.trim();

    if (!chipName) {
      addLog("error", "请先在右侧配置检查器输入目标芯片型号");
      return;
    }

    try {
      setRttConnecting(true);
      useProbeStore.getState().setError(null);
      addLog("info", `正在连接 RTT (${chipName})...`);

      const target = await connectRtt({
        probe_identifier: selectedProbe.probe_id,
        target: chipName,
        interface_type: settings.interfaceType === "SWD" ? "Swd" : "Jtag",
        clock_speed: settings.clockSpeed,
        connect_mode: settings.connectMode === "Normal" ? "Normal" : "UnderReset",
      });

      setRttCoreCount(target.core_count ?? 1);
      setRttConnected(true);
      addLog("success", `RTT 连接成功: ${chipName}`);
    } catch (error) {
      addLog("error", `RTT 连接失败: ${error}`);
      useProbeStore.getState().setError(String(error));
      setRttConnected(false);
    } finally {
      setRttConnecting(false);
    }
  };

  // RTT 断开
  const handleRttDisconnect = async () => {
    try {
      // 借用烧录连接运行时，断开独立连接不影响它；否则后端会随连接一起停止轮询
      const sharesMain = useRttStore.getState().rttInfo?.session_source === "main";
      if ((isRunning || isStarting) && !sharesMain) {
        await stopRtt();
        setRunning(false);
      }

      await disconnectRtt();
      setRttConnected(false);
      addLog("info", "RTT 已断开");
    } catch (error) {
      addLog("error", `RTT 断开失败: ${error}`);
    }
  };

  // 启动 RTT
  const handleStart = async () => {
    const store = useRttStore.getState();
    if (store.isStarting || store.isRunning) return;
    const built = buildRttStartOptions(store.startSettings, coreCount);
    if ("error" in built) {
      addLog("error", `启动 RTT 失败: ${built.error}`);
      store.setError(built.error);
      return;
    }

    try {
      store.setError(null);
      setStarting(true);
      addLog("info", "正在查找 RTT 控制块...");

      const config = await startRtt(built.options);

      // 扫描期间点了“取消”：后端已不再起轮询线程
      if (!useRttStore.getState().isStarting) return;
      setStarting(false);
      store.applyConfig(config);
      setRunning(true);
      store.setPhase("attached");
      const address = config.control_block_address;
      addLog(
        "success",
        `RTT 已启动（${config.located_by}${address === null ? "" : `，控制块 ${formatHexAddress(address)}`}，${
          config.session_source === "main" ? "使用烧录连接" : "独立 RTT 连接"
        }）`
      );

      // 显示通道信息
      for (const ch of config.up_channels) {
        addLog("info", `  上行通道 ${ch.index}: ${ch.name || "(未命名)"} - ${ch.buffer_size} 字节`);
      }
      for (const ch of config.down_channels) {
        addLog("info", `  下行通道 ${ch.index}: ${ch.name || "(未命名)"} - ${ch.buffer_size} 字节`);
      }
    } catch (error) {
      // 取消启动产生的错误不算失败
      if (!useRttStore.getState().isStarting) return;
      const message = String(error).replace(/^RTT错误: /, "");
      addLog("error", `启动 RTT 失败: ${message}`);
      useRttStore.getState().setError(message);
    }
  };

  // 停止 RTT（启动中则取消扫描）
  const handleStop = async () => {
    const cancelling = useRttStore.getState().isStarting;
    try {
      await stopRtt();
      setRunning(false);
      addLog("info", cancelling ? "已取消启动 RTT" : "RTT 已停止");
    } catch (error) {
      addLog("error", `停止 RTT 失败: ${error}`);
    }
  };

  // 暂停/继续
  const handleTogglePause = () => {
    setPaused(!isPaused);
  };

  // 清空
  const handleClear = () => {
    clearLines();
  };

  const handleExportTxt = async () => {
    const { lines } = useRttStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可导出");
      return;
    }
    try {
      const path = await exportRttLinesAsTxt(lines);
      if (path) addLog("success", `已导出 ${lines.length} 行到 ${path}`);
    } catch (err) {
      addLog("error", `导出失败: ${err}`);
    }
  };

  const handleExportCsv = async () => {
    const { lines } = useRttStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可导出");
      return;
    }
    try {
      const path = await exportRttLinesAsCsv(lines);
      if (path) addLog("success", `已导出 ${lines.length} 行到 ${path}`);
    } catch (err) {
      addLog("error", `导出失败: ${err}`);
    }
  };

  // 复制全部：从数据数组直接生成（不受虚拟滚动卸载影响），与文本区显示的过滤结果一致
  const handleCopyAll = () => {
    const { lines, selectedChannel, searchQuery, showTimestamp } = useRttStore.getState();
    let filtered = lines;
    if (selectedChannel >= 0) filtered = filtered.filter((l) => l.direction === "tx" || l.channel === selectedChannel);
    const q = searchQuery.trim().toLowerCase();
    if (q) filtered = filtered.filter((l) => l.text.toLowerCase().includes(q));
    copyAllLines(filtered, (l) => formatRttLineForCopy(l, showTimestamp), addLog);
  };

  // 智能启用图表
  const handleSmartEnableChart = () => {
    const { lines } = useRttStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可分析，请先启动 RTT 并接收一些数据");
      return;
    }

    // 帧头过滤应先于截取，避免低频采样被高频普通日志挤出样本窗口。
    const sampleLines = lines
      .map((line) => line.text)
      .filter((text) => !chartConfig.framePrefix || text.startsWith(chartConfig.framePrefix))
      .slice(-20);

    const { config: newConfig, detection: result } = detectChartConfig(
      chartConfig,
      sampleLines.map((text) => ({ text }))
    );

    if (result.confidence < 0.5) {
      addLog("warn", `无法识别数据格式（置信度: ${(result.confidence * 100).toFixed(0)}%）`);
      addLog("info", "请手动配置图表或确保数据格式正确");
      return;
    }

    setChartConfig(newConfig);

    // 切换到分屏或图表视图
    if (viewMode === "text") {
      setViewMode("split");
    }

    addLog("success", result.description);
    addLog("info", `已自动配置 ${result.detectedKeys.length} 个数据系列`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-border/60 bg-muted/20 px-2 py-2">
      {!rttConnected ? (
        <Button size="sm" variant="default" onClick={handleRttConnect} disabled={rttConnecting} className="gap-1">
          <Link className={rttConnecting ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
          {rttConnecting ? "连接中..." : "连接 RTT"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={handleRttDisconnect}
          className="gap-1 border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-500"
        >
          <Unlink className="h-3.5 w-3.5" />
          断开 RTT
        </Button>
      )}

      {isStarting ? (
        // key 让三种状态各自挂载，避免颜色过渡把“取消启动”短暂显示成绿色
        <Button key="cancel" size="sm" variant="destructive" onClick={handleStop} className="gap-1">
          <Square className="h-3.5 w-3.5 animate-pulse" />
          取消启动
        </Button>
      ) : !isRunning ? (
        <Button
          key="start"
          size="sm"
          onClick={handleStart}
          disabled={!canStart}
          title={canStart ? undefined : "请先连接 RTT，或在烧录工作台连接设备"}
          className="gap-1 bg-green-600 text-white hover:bg-green-700"
        >
          <Play className="h-3.5 w-3.5" />
          启动
        </Button>
      ) : (
        <Button key="stop" size="sm" variant="destructive" onClick={handleStop} className="gap-1">
          <Square className="h-3.5 w-3.5" />
          停止
        </Button>
      )}

      <RttStartSettingsPanel coreCount={coreCount} disabled={isRunning || isStarting} />

      <Button
        size="sm"
        variant={isPaused ? "secondary" : "outline"}
        onClick={handleTogglePause}
        disabled={!isRunning}
        title="暂停只冻结文本区显示，数据继续接收，继续后补上"
        className="gap-1"
      >
        {isPaused ? <RotateCcw className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {isPaused ? (pausedBacklog > 0 ? `继续 (+${pausedBacklog.toLocaleString()})` : "继续") : "暂停显示"}
      </Button>

      <Button size="sm" variant="outline" onClick={handleClear} className="gap-1">
        <Trash2 className="h-3.5 w-3.5" />
        清空
      </Button>

      <div className="mx-1 h-6 w-px bg-border" />
      <DataViewSwitch value={viewMode} onChange={setViewMode} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative w-40 sm:w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索 RTT..."
            value={rttSearchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
            data-shortcut-search
          />
        </div>

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
                <div className="text-xs text-muted-foreground">分析、显示、配置和导出都在这里。</div>
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
                      <RttIntegrationGuideDialog />
                      <Button
                        size="sm"
                        variant={chartConfig.enabled ? "secondary" : "outline"}
                        onClick={handleSmartEnableChart}
                        disabled={lineCount === 0}
                        className="gap-1"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        智能启用
                      </Button>
                      <SessionRecordControls
                        source="rtt"
                        recording={sessionRecording}
                        setRecording={setSessionRecording}
                        getChartConfig={() => useRttStore.getState().chartConfig}
                        onBeforeReplay={() => useRttStore.getState().clearChartData()}
                        onReplayed={(result, config) => {
                          const state = useRttStore.getState();
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
                        ? "已收起图表，继续在后台解析数据"
                        : domain === "fft"
                          ? "已打开 FFT 频谱"
                          : "已打开时域波形"
                    )
                  }
                />
              </div>

              <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
                <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">查看</div>
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    size="sm"
                    variant={autoScroll ? "secondary" : "outline"}
                    onClick={() => setAutoScroll(!autoScroll)}
                    className="gap-1"
                  >
                    自动滚动
                  </Button>
                  <Button
                    size="sm"
                    variant={displayMode === "hex" ? "secondary" : "outline"}
                    onClick={() => setDisplayMode(displayMode === "text" ? "hex" : "text")}
                    className="gap-1"
                  >
                    {displayMode === "hex" ? <Binary className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    {displayMode === "hex" ? "Hex" : "文本"}
                  </Button>
                </div>
              </div>

              <RxFramingSettingsPanel
                framing={rxFraming}
                setFraming={setRxFraming}
                hint="RTT 通常是 printf 输出，保持「换行」即可；传二进制或定长包时用「空闲超时」。"
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
                <div className="flex flex-wrap gap-2.5">
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
                  <ColorSettingsDialog
                    trigger={
                      <Button size="sm" variant="outline" className="gap-1">
                        <Settings2 className="h-3.5 w-3.5" />
                        颜色设置
                      </Button>
                    }
                  />
                </div>
              </div>

              <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
                <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">输出</div>
                <div className="flex flex-wrap gap-2.5">
                  <Button size="sm" variant="outline" onClick={handleCopyAll} className="gap-1">
                    <Copy className="h-3.5 w-3.5" />
                    复制全部
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportTxt} className="gap-1">
                    <Download className="h-3.5 w-3.5" />
                    导出 TXT
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportCsv} className="gap-1">
                    <Download className="h-3.5 w-3.5" />
                    导出 CSV
                  </Button>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <LazyChartConfigDialog
          chartConfig={chartConfig}
          setChartConfig={setChartConfig}
          title="RTT 图表配置"
          allowBytesParsers
          samples={chartSamples}
          open={chartConfigOpen}
          onOpenChange={setChartConfigOpen}
          trigger={null}
        />
      </div>
    </div>
  );
}
