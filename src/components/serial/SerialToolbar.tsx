import { useSerialStore } from "@/stores/serialStore";
import { useLogStore } from "@/stores/logStore";
import { stopSerial, startSerial, clearSerialBuffer } from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { DataViewSwitch, SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SerialLine, SerialTextViewMode } from "@/lib/serialTypes";
import {
  Play,
  Square,
  Trash2,
  Download,
  Copy,
  Search,
  FileText,
  SquareTerminal,
  Sparkles,
  SlidersHorizontal,
  Settings2,
  ArrowDown,
  Clock,
  Columns,
  Tags,
} from "lucide-react";
import { LazyChartConfigDialog } from "@/components/lazyDialogs";
import { ColorSettingsDialog } from "@/components/rtt/ColorSettingsDialog";
import { SessionRecordControls } from "@/components/rtt/SessionRecordControls";
import { RxFramingSettingsPanel } from "@/components/rtt/RxFramingSettingsPanel";
import { TriggerSettingsPanel } from "@/components/rtt/TriggerSettingsPanel";
import { detectChartConfig, recentChartSamples } from "@/lib/chartAnalysis";
import { exportSerialLinesAsTxt, exportSerialLinesAsCsv } from "@/lib/exporters";
import { copyAllLines, formatSerialLineForCopy } from "@/lib/viewerCopy";
import { useShallow } from "zustand/react/shallow";
import { AiBridgeControl, AiSkillLink } from "./AiBridgeControl";
import { useMemo, useState } from "react";
import { formatTimestamp } from "@/lib/formatters";

const TIMESTAMP_PREVIEW_TIME = Date.UTC(2024, 0, 2, 3, 4, 5, 678);

/** 稳定的空数组引用：配置对话框关闭时用它替代 lines，避免订阅到每帧都换 identity 的大数组。 */
const NO_SAMPLE_LINES: SerialLine[] = [];

const TIMESTAMP_FORMAT_PRESETS = [
  ["YYYY-MM-DD HH:mm:ss.SSS", "年月日 + 时分秒毫秒"],
  ["YYYY-MM-DD HH:mm:ss", "年月日 + 时分秒"],
  ["HH:mm:ss.SSS", "时分秒毫秒"],
  ["HH:mm:ss", "时分秒"],
  ["mm:ss.SSS", "分秒毫秒"],
  ["mm:ss", "分秒"],
] as const;

const TEXT_VIEW_OPTIONS: readonly SegmentedOption<SerialTextViewMode>[] = [
  { value: "log", label: "日志", icon: FileText, title: "按行显示的日志视图" },
  { value: "terminal", label: "终端", icon: SquareTerminal, title: "支持 ANSI 与光标控制的终端视图" },
];

export function SerialToolbar() {
  const {
    connected,
    running,
    autoScroll,
    showTimestamp,
    timestampFormat,
    showDirectionPrefix,
    splitByDirection,
    searchQuery,
    textViewMode,
    terminalSettings,
    viewMode,
    splitOrientation,
    chartConfig,
    rxFraming,
    setRxFraming,
    chartPaused,
    triggeredAt,
    rearmTrigger,
    setRunning,
    setAutoScroll,
    setShowTimestamp,
    setTimestampFormat,
    setShowDirectionPrefix,
    setSplitByDirection,
    setSearchQuery,
    setTextViewMode,
    setTerminalSettings,
    setViewMode,
    setSplitOrientation,
    clearLines,
    setChartConfig,
    sessionRecording,
    setSessionRecording,
  } = useSerialStore(
    useShallow((state) => ({
      connected: state.connected,
      running: state.running,
      autoScroll: state.autoScroll,
      showTimestamp: state.showTimestamp,
      timestampFormat: state.timestampFormat,
      showDirectionPrefix: state.showDirectionPrefix,
      splitByDirection: state.splitByDirection,
      searchQuery: state.searchQuery,
      textViewMode: state.textViewMode,
      terminalSettings: state.terminalSettings,
      viewMode: state.viewMode,
      splitOrientation: state.splitOrientation,
      chartConfig: state.chartConfig,
      rxFraming: state.rxFraming,
      setRxFraming: state.setRxFraming,
      chartPaused: state.chartPaused,
      triggeredAt: state.triggeredAt,
      rearmTrigger: state.rearmTrigger,
      setRunning: state.setRunning,
      setAutoScroll: state.setAutoScroll,
      setShowTimestamp: state.setShowTimestamp,
      setTimestampFormat: state.setTimestampFormat,
      setShowDirectionPrefix: state.setShowDirectionPrefix,
      setSplitByDirection: state.setSplitByDirection,
      setSearchQuery: state.setSearchQuery,
      setTextViewMode: state.setTextViewMode,
      setTerminalSettings: state.setTerminalSettings,
      setViewMode: state.setViewMode,
      setSplitOrientation: state.setSplitOrientation,
      clearLines: state.clearLines,
      setChartConfig: state.setChartConfig,
      sessionRecording: state.sessionRecording,
      setSessionRecording: state.setSessionRecording,
    }))
  );

  const addLog = useLogStore((state) => state.addLog);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chartConfigOpen, setChartConfigOpen] = useState(false);

  // 工具栏渲染时只需要「有没有数据」。订阅整个 lines 会让它每帧重渲染一次
  // （lines 每批都换 identity，useShallow 也挡不住），而工具栏是个很大的树。
  const lineCount = useSerialStore((state) => state.lines.length);
  // 只有图表配置对话框打开时才需要实时样本；关闭时返回稳定空引用。
  const chartSampleLines = useSerialStore((state) => (chartConfigOpen ? state.lines : NO_SAMPLE_LINES));
  const chartSamples = useMemo(
    () => recentChartSamples(chartSampleLines, 20, (line) => line.direction === "rx"),
    [chartSampleLines]
  );

  // Start serial polling
  const handleStart = async () => {
    if (!connected) {
      addLog("error", "请先连接串口");
      return;
    }

    try {
      await startSerial(10);
      setRunning(true);
      addLog("info", "串口数据接收已启动");
    } catch (error) {
      addLog("error", `启动失败: ${error}`);
    }
  };

  // Stop serial polling
  const handleStop = async () => {
    try {
      await stopSerial();
      setRunning(false);
      addLog("info", "串口数据接收已停止");
    } catch (error) {
      addLog("error", `停止失败: ${error}`);
    }
  };

  // Clear data
  const handleClear = async () => {
    clearLines();
    try {
      await clearSerialBuffer();
    } catch {
      // Ignore
    }
  };

  // 复制全部：从数据数组直接生成（不受虚拟滚动卸载影响），与文本区显示一致
  const handleCopyAll = () => {
    const { lines, searchQuery, showTimestamp, showDirectionPrefix, timestampFormat } = useSerialStore.getState();
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
    copyAllLines(
      filtered,
      (l) => formatSerialLineForCopy(l, showTimestamp, showDirectionPrefix, timestampFormat),
      addLog
    );
  };

  const handleExportTxt = async () => {
    const { lines, timestampFormat } = useSerialStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可导出");
      return;
    }
    try {
      const path = await exportSerialLinesAsTxt(lines, timestampFormat);
      if (path) addLog("success", `已导出 ${lines.length} 行到 ${path}`);
    } catch (err) {
      addLog("error", `导出失败: ${err}`);
    }
  };

  const handleExportCsv = async () => {
    const { lines } = useSerialStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可导出");
      return;
    }
    try {
      const path = await exportSerialLinesAsCsv(lines);
      if (path) addLog("success", `已导出 ${lines.length} 行到 ${path}`);
    } catch (err) {
      addLog("error", `导出失败: ${err}`);
    }
  };

  // Smart enable chart
  const handleSmartEnableChart = () => {
    const { lines } = useSerialStore.getState();
    if (lines.length === 0) {
      addLog("warn", "没有数据可分析，请先接收一些数据");
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

    // Switch to split or chart view
    if (viewMode === "text") {
      setViewMode("split");
    }

    addLog("success", result.description);
    addLog("info", `已自动配置 ${result.detectedKeys.length} 个数据系列`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-border/60 bg-muted/20 px-2 py-2">
      {!running ? (
        <Button
          size="sm"
          onClick={handleStart}
          disabled={!connected}
          className="gap-1 bg-green-600 text-white hover:bg-green-700"
        >
          <Play className="h-3.5 w-3.5" />
          开始
        </Button>
      ) : (
        <Button size="sm" variant="destructive" onClick={handleStop} className="gap-1">
          <Square className="h-3.5 w-3.5" />
          停止
        </Button>
      )}

      <Button size="sm" variant="outline" onClick={handleClear} className="gap-1">
        <Trash2 className="h-3.5 w-3.5" />
        清空
      </Button>

      <div className="mx-1 h-6 w-px bg-border" />
      <SegmentedControl
        value={textViewMode}
        options={TEXT_VIEW_OPTIONS}
        onChange={setTextViewMode}
        aria-label="文本显示方式"
      />
      <DataViewSwitch value={viewMode} onChange={setViewMode} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {textViewMode === "log" && (
          <div className="relative w-40 sm:w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索串口..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-7 text-xs"
              data-shortcut-search
            />
          </div>
        )}

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
                <div className="text-xs text-muted-foreground">
                  {textViewMode === "terminal"
                    ? "终端的本地回显、快捷键拦截和颜色配置都在这里。"
                    : "收发分屏、时间戳、显示方式和导出都在这里。"}
                </div>
              </div>

              <div className="space-y-2.5 rounded-[16px] border border-border/60 bg-muted/20 p-3">
                <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">工作流</div>
                <div className="flex flex-wrap gap-2">
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
                    source="serial"
                    recording={sessionRecording}
                    setRecording={setSessionRecording}
                    getChartConfig={() => useSerialStore.getState().chartConfig}
                    getFraming={() => useSerialStore.getState().rxFraming}
                    onBeforeReplay={() => useSerialStore.getState().clearChartData()}
                    onReplayed={(result, config) => {
                      const state = useSerialStore.getState();
                      state.setChartConfig(config);
                      state.commitSerialReceiveBatch(result);
                    }}
                  />
                  <AiBridgeControl />
                  <AiSkillLink />
                </div>
                {viewMode === "split" && (
                  <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-border/50 bg-background/40 p-1">
                    <Button
                      size="sm"
                      variant={splitOrientation === "vertical" ? "secondary" : "ghost"}
                      onClick={() => setSplitOrientation("vertical")}
                      className="h-8"
                    >
                      上下分屏
                    </Button>
                    <Button
                      size="sm"
                      variant={splitOrientation === "horizontal" ? "secondary" : "ghost"}
                      onClick={() => setSplitOrientation("horizontal")}
                      className="h-8"
                    >
                      左右分屏
                    </Button>
                  </div>
                )}
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
                    <ArrowDown className="h-3.5 w-3.5" />
                    自动滚动
                  </Button>
                  {textViewMode === "log" ? (
                    <>
                      <Button
                        size="sm"
                        variant={showTimestamp ? "secondary" : "outline"}
                        onClick={() => setShowTimestamp(!showTimestamp)}
                        className="gap-1"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        时间戳
                      </Button>
                      <Button
                        size="sm"
                        variant={showDirectionPrefix ? "secondary" : "outline"}
                        onClick={() => setShowDirectionPrefix(!showDirectionPrefix)}
                        className="gap-1"
                      >
                        <Tags className="h-3.5 w-3.5" />
                        RX/TX 前缀
                      </Button>
                      <Button
                        size="sm"
                        variant={splitByDirection ? "secondary" : "outline"}
                        onClick={() => setSplitByDirection(!splitByDirection)}
                        className="gap-1"
                      >
                        <Columns className="h-3.5 w-3.5" />
                        收发分屏
                      </Button>
                    </>
                  ) : textViewMode === "terminal" ? (
                    <>
                      <Button
                        size="sm"
                        variant={terminalSettings.localEcho ? "secondary" : "outline"}
                        onClick={() => setTerminalSettings({ localEcho: !terminalSettings.localEcho })}
                        className="gap-1"
                      >
                        <SquareTerminal className="h-3.5 w-3.5" />
                        本地回显
                      </Button>
                      <Button
                        size="sm"
                        variant={terminalSettings.interceptShortcuts ? "secondary" : "outline"}
                        onClick={() =>
                          setTerminalSettings({
                            interceptShortcuts: !terminalSettings.interceptShortcuts,
                          })
                        }
                        className="gap-1"
                      >
                        <Tags className="h-3.5 w-3.5" />
                        控制键拦截
                      </Button>
                      <Button
                        size="sm"
                        variant={terminalSettings.lineMode ? "secondary" : "outline"}
                        onClick={() =>
                          setTerminalSettings({
                            lineMode: !terminalSettings.lineMode,
                          })
                        }
                        className="gap-1"
                        title="开启后键盘输入先在本地累积，回车整行发送，↑↓ 翻历史"
                      >
                        <SquareTerminal className="h-3.5 w-3.5" />
                        行编辑模式
                      </Button>
                    </>
                  ) : null}
                </div>
                {textViewMode === "log" && showTimestamp && (
                  <div className="space-y-2 rounded-xl border border-border/50 bg-background/55 p-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">时间格式</span>
                      <code className="text-xs text-muted-foreground">
                        {formatTimestamp(TIMESTAMP_PREVIEW_TIME, timestampFormat)}
                      </code>
                    </div>
                    <Select
                      value={
                        TIMESTAMP_FORMAT_PRESETS.some(([value]) => value === timestampFormat)
                          ? timestampFormat
                          : "custom"
                      }
                      onValueChange={(value) => value !== "custom" && setTimestampFormat(value)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMESTAMP_FORMAT_PRESETS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">自定义</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={timestampFormat}
                      maxLength={80}
                      onChange={(event) => setTimestampFormat(event.target.value)}
                      placeholder="例如 YYYY年MM月DD日 HH:mm:ss.SSS"
                      className="h-8 font-mono text-xs"
                    />
                    <div className="text-xs leading-4 text-muted-foreground">
                      可用：YYYY 年、MM 月、DD 日、HH 时、mm 分、ss 秒、SSS 毫秒；留空使用默认格式。
                    </div>
                  </div>
                )}
              </div>

              {textViewMode === "log" && (
                <RxFramingSettingsPanel
                  framing={rxFraming}
                  setFraming={setRxFraming}
                  hint="无固定换行的二进制/HEX 请求-应答用「空闲超时」；带特殊帧头帧尾用「自定义」。"
                />
              )}

              {/* 触发管的是图表，与文本视图模式无关，因此不受 textViewMode 限制 */}
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
                    title="串口颜色标记设置"
                    description="串口终端和 RTT 共用同一套颜色标记语法，可在这里统一调整。"
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
          title="串口图表配置"
          allowBytesParsers
          allowDataFilter
          allowParserConfig={false}
          samples={chartSamples}
          open={chartConfigOpen}
          onOpenChange={setChartConfigOpen}
          trigger={null}
        />
      </div>
    </div>
  );
}
