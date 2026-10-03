import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Search, Trash2, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataViewSwitch } from "@/components/ui/segmented-control";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SerialViewer } from "@/components/serial/SerialViewer";
import { ChartViewer } from "@/components/rtt/ChartViewer";
import { LazyChartConfigDialog } from "@/components/lazyDialogs";
import type { SerialLine } from "@/lib/serialTypes";
import type { ChartDataPoint, TelemetryConfig, ViewMode } from "@/lib/chartTypes";
import { DEFAULT_CHART_CONFIG, migrateChartConfig } from "@/lib/chartTypes";
import { populateEmptyChannelsFromSamples, type ChartSample } from "@/lib/chartAnalysis";
import { TelemetryIngestionBuffer } from "@/lib/chartIngestion";
import { resolveTelemetryProcessing } from "@/lib/telemetry";
import { detectLogFramePrefix, streamLogLines } from "@/lib/logImport";
import { createSimulationSample, normalizeSimulationConfig } from "@/lib/serialSimulation";
import { formatBytes } from "@/lib/formatters";
import { parseLogLevel } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useSerialStore } from "@/stores/serialStore";

const CHART_PARSE_BATCH_SIZE = 5_000;
const PREFIX_SAMPLE_LIMIT = 20;
const SIMULATION_SAMPLE_COUNT = 1_000;
const SIMULATION_PREFIX = "SIM:";

interface LogPrefixSummary {
  prefix: string;
  count: number;
  samples: ChartSample[];
}

export function LogAnalysisMode() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRunRef = useRef(0);
  const chartRunRef = useRef(0);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [lines, setLines] = useState<SerialLine[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [inferredTimestampCount, setInferredTimestampCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [prefixSummaries, setPrefixSummaries] = useState<LogPrefixSummary[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("text");
  const [chartConfig, setChartConfig] = useState(() => migrateChartConfig(DEFAULT_CHART_CONFIG));
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartPaused, setChartPaused] = useState(false);
  const [chartParsing, setChartParsing] = useState(false);
  const [chartProgress, setChartProgress] = useState(0);
  const [parseSuccessCount, setParseSuccessCount] = useState(0);
  const [parseFailCount, setParseFailCount] = useState(0);
  const simulationConfig = useSerialStore((state) => state.simulationConfig);

  const selectedPrefixSummary = useMemo(
    () => prefixSummaries.find(({ prefix }) => prefix === chartConfig.framePrefix),
    [chartConfig.framePrefix, prefixSummaries]
  );
  const samples = useMemo(
    () => selectedPrefixSummary?.samples ?? lines.slice(0, 200).map((line) => ({ text: line.text })),
    [lines, selectedPrefixSummary]
  );
  const parsingConfig = useMemo<TelemetryConfig>(
    () => ({
      enabled: chartConfig.enabled,
      parseMode: chartConfig.parseMode,
      framePrefix: chartConfig.framePrefix,
      regexPattern: chartConfig.regexPattern,
      regexFlags: chartConfig.regexFlags,
      delimiter: chartConfig.delimiter,
      modbusRtu: chartConfig.modbusRtu,
      canBus: chartConfig.canBus,
      binaryProtocol: chartConfig.binaryProtocol,
      channels: chartConfig.channels,
      maxDataPoints: chartConfig.maxDataPoints,
      sampleRateHz: chartConfig.sampleRateHz,
      dataFilter: chartConfig.dataFilter,
      trigger: chartConfig.trigger,
    }),
    [
      chartConfig.binaryProtocol,
      chartConfig.canBus,
      chartConfig.channels,
      chartConfig.dataFilter,
      chartConfig.delimiter,
      chartConfig.enabled,
      chartConfig.framePrefix,
      chartConfig.maxDataPoints,
      chartConfig.modbusRtu,
      chartConfig.parseMode,
      chartConfig.regexFlags,
      chartConfig.regexPattern,
      chartConfig.sampleRateHz,
      chartConfig.trigger,
    ]
  );
  const viewerData = useMemo(
    () => ({
      autoScroll: false,
      showTimestamp: true,
      timestampFormat: "YYYY-MM-DD HH:mm:ss.SSS",
      showDirectionPrefix: false,
      running: true,
      displayMode: "text" as const,
      connected: true,
      lines,
      searchQuery,
    }),
    [lines, searchQuery]
  );
  const processing = useMemo(
    () => resolveTelemetryProcessing(chartData, chartConfig.channels, chartConfig.dataFilter),
    [chartConfig.channels, chartConfig.dataFilter, chartData]
  );

  const clear = () => {
    importRunRef.current += 1;
    chartRunRef.current += 1;
    setFileName("");
    setFileSize(0);
    setLines([]);
    setImportedCount(0);
    setInferredTimestampCount(0);
    setImporting(false);
    setImportError("");
    setSearchQuery("");
    setPrefixSummaries([]);
    setChartData([]);
    setChartParsing(false);
    setChartProgress(0);
    setParseSuccessCount(0);
    setParseFailCount(0);
  };

  const importFile = async (file: File) => {
    const runId = ++importRunRef.current;
    const importedLines: SerialLine[] = [];
    const detectedPrefixes = new Map<string, LogPrefixSummary>();
    let inferred = 0;

    setFileName(file.name);
    setFileSize(file.size);
    setLines([]);
    setImportedCount(0);
    setInferredTimestampCount(0);
    setPrefixSummaries([]);
    setImportError("");
    setImporting(true);

    try {
      for await (const batch of streamLogLines(file)) {
        if (runId !== importRunRef.current) return;
        for (const line of batch) {
          const prefix = detectLogFramePrefix(line.text);
          if (prefix) {
            const summary = detectedPrefixes.get(prefix) ?? { prefix, count: 0, samples: [] };
            summary.count += 1;
            if (summary.samples.length < PREFIX_SAMPLE_LIMIT) summary.samples.push({ text: line.text });
            detectedPrefixes.set(prefix, summary);
          }
          importedLines.push({
            id: line.lineNumber,
            timestamp: new Date(line.timestamp),
            text: line.text,
            level: parseLogLevel(line.text),
            direction: "rx",
          });
          if (line.timestampInferred) inferred += 1;
        }
        setImportedCount(importedLines.length);
        setInferredTimestampCount(inferred);
      }

      if (runId === importRunRef.current) {
        setLines(importedLines);
        setPrefixSummaries(
          Array.from(detectedPrefixes.values()).sort((left, right) => left.prefix.localeCompare(right.prefix))
        );
      }
    } catch (error) {
      if (runId === importRunRef.current) setImportError(String(error));
    } finally {
      if (runId === importRunRef.current) setImporting(false);
    }
  };

  const loadSimulation = () => {
    importRunRef.current += 1;
    chartRunRef.current += 1;
    const config = normalizeSimulationConfig(simulationConfig);
    const intervalMs = 1_000 / config.sampleRateHz;
    const startedAt = Date.now() - (SIMULATION_SAMPLE_COUNT - 1) * intervalMs;
    const simulatedLines = Array.from({ length: SIMULATION_SAMPLE_COUNT }, (_, index) => {
      const text = `${SIMULATION_PREFIX}${JSON.stringify(createSimulationSample(config, index / config.sampleRateHz))}`;
      return {
        id: index + 1,
        timestamp: new Date(startedAt + index * intervalMs),
        text,
        level: parseLogLevel(text),
        direction: "rx" as const,
      };
    });
    const summary: LogPrefixSummary = {
      prefix: SIMULATION_PREFIX,
      count: simulatedLines.length,
      samples: simulatedLines.slice(0, PREFIX_SAMPLE_LIMIT).map(({ text }) => ({ text })),
    };
    const inferredConfig = populateEmptyChannelsFromSamples(
      {
        ...chartConfig,
        enabled: false,
        parseMode: "auto",
        framePrefix: SIMULATION_PREFIX,
        regexPattern: "",
        regexFlags: "",
        channels: [],
      },
      summary.samples
    );

    setFileName(`模拟数据-${config.preset}.log`);
    setFileSize(new Blob(simulatedLines.map(({ text }) => `${text}\n`)).size);
    setLines(simulatedLines);
    setImportedCount(simulatedLines.length);
    setInferredTimestampCount(0);
    setImporting(false);
    setImportError("");
    setSearchQuery("");
    setPrefixSummaries([summary]);
    setChartData([]);
    setChartProgress(0);
    setParseSuccessCount(0);
    setParseFailCount(0);
    setChartConfig(migrateChartConfig({ ...inferredConfig, enabled: true, sampleRateHz: config.sampleRateHz }));
    setViewMode("split");
  };

  useEffect(() => {
    const runId = ++chartRunRef.current;
    if (!parsingConfig.enabled || lines.length === 0) {
      setChartData([]);
      setChartParsing(false);
      setChartProgress(0);
      setParseSuccessCount(0);
      setParseFailCount(0);
      return;
    }

    const parse = async () => {
      const ingestion = new TelemetryIngestionBuffer(parsingConfig.maxDataPoints);
      setChartParsing(true);
      setChartProgress(0);

      for (let offset = 0; offset < lines.length; offset += CHART_PARSE_BATCH_SIZE) {
        if (runId !== chartRunRef.current) return;
        ingestion.ingestLines(lines.slice(offset, offset + CHART_PARSE_BATCH_SIZE), parsingConfig);
        setChartProgress(Math.min(100, Math.round(((offset + CHART_PARSE_BATCH_SIZE) / lines.length) * 100)));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      if (runId === chartRunRef.current) {
        const parsed = ingestion.drain();
        setChartData(parsed.points);
        setParseSuccessCount(parsed.success);
        setParseFailCount(parsed.fail);
        setChartParsing(false);
        setChartProgress(100);
      }
    };

    void parse();
    return () => {
      if (chartRunRef.current === runId) chartRunRef.current += 1;
    };
  }, [lines, parsingConfig]);

  const selectAnalysisPrefix = (prefix: string) => {
    const summary = prefixSummaries.find((item) => item.prefix === prefix);
    if (!summary) return;

    const inferredConfig = populateEmptyChannelsFromSamples(
      {
        ...chartConfig,
        enabled: false,
        parseMode: "auto",
        framePrefix: prefix,
        regexPattern: "",
        regexFlags: "",
        channels: [],
      },
      summary.samples
    );
    setChartConfig(migrateChartConfig({ ...inferredConfig, enabled: true }));
    setViewMode("split");
  };

  const hasText = viewMode !== "chart";
  const hasChart = viewMode !== "text";
  const visibleChannelCount = chartConfig.channels.filter((channel) => channel.visible).length;

  const setAllChannelsVisible = (visible: boolean) => {
    setChartConfig((current) => ({
      ...current,
      channels: current.channels.map((channel) => ({ ...channel, visible })),
    }));
  };

  return (
    <div className="surface-strong flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-[14px] p-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".log,.txt,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importFile(file);
        }}
      />

      <div className="surface-card flex shrink-0 flex-wrap items-center gap-2 rounded-[18px] px-3 py-2">
        <Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {fileName ? "重新导入" : "导入日志"}
        </Button>

        <Button size="sm" variant="outline" className="gap-1.5" onClick={loadSimulation} disabled={importing}>
          <Waves className="h-4 w-4" />
          模拟数据
        </Button>

        <Select
          value={selectedPrefixSummary?.prefix ?? "__none"}
          onValueChange={(value) => {
            if (value !== "__none") selectAnalysisPrefix(value);
          }}
          disabled={prefixSummaries.length === 0}
        >
          <SelectTrigger className="h-8 w-48">
            <SelectValue placeholder="选择分析前缀" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">选择分析前缀</SelectItem>
            {prefixSummaries.map(({ prefix, count }) => (
              <SelectItem key={prefix} value={prefix}>
                前缀 {prefix} · {count.toLocaleString()} 行
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative min-w-52 flex-1 md:max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-shortcut-search
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索日志内容"
            className="h-8 pl-8"
            disabled={lines.length === 0}
          />
        </div>

        <DataViewSwitch value={viewMode} onChange={setViewMode} />

        {chartConfig.channels.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                通道 {visibleChannelCount}/{chartConfig.channels.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">显示通道</div>
                  <div className="text-xs text-muted-foreground">取消勾选可隐藏曲线</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAllChannelsVisible(true)}>
                    全选
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAllChannelsVisible(false)}>
                    清空
                  </Button>
                </div>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {chartConfig.channels.map((channel, index) => (
                  <label
                    key={`${channel.key}-${index}`}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={channel.visible}
                      onChange={(event) =>
                        setChartConfig((current) => ({
                          ...current,
                          channels: current.channels.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, visible: event.target.checked } : item
                          ),
                        }))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{channel.name || channel.key}</span>
                    {channel.name !== channel.key && (
                      <code className="max-w-24 truncate text-xs text-muted-foreground">{channel.key}</code>
                    )}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <LazyChartConfigDialog
          chartConfig={chartConfig}
          setChartConfig={(config) => setChartConfig(migrateChartConfig(config))}
          samples={samples}
          title="日志解析与图表配置"
          allowParserConfig
          trigger={
            <Button size="sm" variant="outline" disabled={lines.length === 0}>
              高级设置
            </Button>
          }
        />

        <Button size="sm" variant="ghost" className="gap-1" onClick={clear} disabled={!fileName && !importing}>
          <Trash2 className="h-4 w-4" />
          清空
        </Button>
      </div>

      {(fileName || importError) && (
        <div className="flex min-h-5 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs text-muted-foreground">
          {fileName && (
            <>
              <span className="max-w-80 truncate" title={fileName}>
                {fileName}
              </span>
              <span>{formatBytes(fileSize)}</span>
              <span>{importedCount.toLocaleString()} 行</span>
              {selectedPrefixSummary && (
                <span>
                  分析前缀 {selectedPrefixSummary.prefix} · {selectedPrefixSummary.count.toLocaleString()} 行
                  {chartConfig.parseMode === "auto" && chartConfig.channels.length === 0 && " · 待配置解析规则"}
                </span>
              )}
              {inferredTimestampCount > 0 && (
                <span className="text-amber-600">{inferredTimestampCount} 行时间为推断值</span>
              )}
              {chartParsing && <span>图表解析 {chartProgress}%</span>}
            </>
          )}
          {importError && <span className="text-red-500">导入失败：{importError}</span>}
        </div>
      )}

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-2 overflow-hidden",
          hasText && hasChart ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-rows-1"
        )}
      >
        {lines.length === 0 && !importing ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-border/70 bg-muted/20 text-muted-foreground">
            <FileUp className="h-8 w-8" />
            <span className="text-sm text-foreground">选择日志文件开始分析</span>
            <span className="text-xs">支持 UTF-8 的 .log / .txt 文件，按流读取大文件。</span>
            <div className="mt-1 flex items-center gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                导入日志
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={loadSimulation}>
                <Waves className="h-4 w-4" />
                模拟数据
              </Button>
            </div>
          </div>
        ) : importing ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            正在流式导入 {importedCount.toLocaleString()} 行…
          </div>
        ) : (
          <>
            {hasText && (
              <div className="min-h-0 overflow-hidden rounded-[22px] border border-border/60 bg-background">
                <SerialViewer title="日志" data={viewerData} />
              </div>
            )}
            {hasChart && (
              <div className="min-h-0 overflow-hidden rounded-[22px] border border-border/60 bg-background">
                <ChartViewer
                  chartData={chartData}
                  processedData={processing.processedData}
                  filterActive={processing.filterActive}
                  chartConfig={chartConfig}
                  chartPaused={chartPaused}
                  parseSuccessCount={parseSuccessCount}
                  parseFailCount={parseFailCount}
                  setChartPaused={setChartPaused}
                  clearChartData={() => {
                    setChartData([]);
                    setParseSuccessCount(0);
                    setParseFailCount(0);
                  }}
                  setChartConfig={(config) => setChartConfig(migrateChartConfig(config))}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
