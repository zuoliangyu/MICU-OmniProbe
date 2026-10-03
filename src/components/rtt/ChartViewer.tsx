import { useMemo, useRef, useState } from "react";
import { exportChartDataAsCsv, exportCanvasAsPng, exportSvgAsPng } from "@/lib/exporters";
import { useLogStore } from "@/stores/logStore";
import type { Channel, ChartConfig, ChartDataPoint, SignalDomain } from "@/lib/chartTypes";
import { getVisibleYChannels, getXChannel, PRESET_COLORS } from "@/lib/chartTypes";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Download, Info, Play, Plus, Settings2, Snowflake, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buildChartDisplayRows, calculateChartStatistics } from "@/lib/chartPresentation";
import { formatChartNumber } from "@/lib/formatters";
import { SignalPlotCanvas } from "./SignalPlotCanvas";

interface BrushDomain {
  startIndex?: number;
  endIndex?: number;
}

interface ChannelInspectorEntry {
  key: string;
  name: string;
  color: string;
  visible: boolean;
  unit?: string;
  latestValue: number | null;
  configured: boolean;
  role: "x" | "y";
}

function fallbackChannelColor(index: number) {
  return `hsl(${(index * 53) % 360} 72% 48%)`;
}

export function resolveChartDisplayData(
  chartData: ChartDataPoint[],
  chartPaused: boolean,
  frozenData: ChartDataPoint[]
): { displayedData: ChartDataPoint[]; nextFrozenData: ChartDataPoint[] } {
  if (!chartPaused || chartData.length === 0) {
    return { displayedData: chartData, nextFrozenData: chartData };
  }
  return { displayedData: frozenData, nextFrozenData: frozenData };
}

export interface ChartViewerProps {
  chartData: ChartDataPoint[];
  processedData: ChartDataPoint[];
  filterActive: boolean;
  chartConfig: ChartConfig;
  chartPaused: boolean;
  parseSuccessCount: number;
  parseFailCount: number;
  setChartPaused: (paused: boolean) => void;
  clearChartData: () => void;
  setChartConfig: (config: ChartConfig) => void;
  /** 最近一次触发点时间戳，透传给波形画布用于标记 */
  triggeredAt?: number | null;
}

export function ChartViewer({
  chartData,
  processedData,
  filterActive,
  chartConfig,
  chartPaused,
  parseSuccessCount,
  parseFailCount,
  setChartPaused,
  clearChartData,
  setChartConfig,
  triggeredAt = null,
}: ChartViewerProps) {
  const [zoomDomain, setZoomDomain] = useState<BrushDomain>({});
  const signalDomain = chartConfig.signalDomain ?? "time";
  // ponytail: 冻结快照只跟随当前图表实例；需要跨视图卸载保持同一帧时，再把快照移入各数据源 store。
  const frozenChartDataRef = useRef(chartData);
  const { displayedData, nextFrozenData } = resolveChartDisplayData(chartData, chartPaused, frozenChartDataRef.current);
  frozenChartDataRef.current = nextFrozenData;
  const frozenProcessedDataRef = useRef(processedData);
  const processedDisplay = resolveChartDisplayData(processedData, chartPaused, frozenProcessedDataRef.current);
  frozenProcessedDataRef.current = processedDisplay.nextFrozenData;
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const addLog = useLogStore((s) => s.addLog);
  const xChannel = useMemo(() => getXChannel(chartConfig), [chartConfig]);
  const xChannelKey = xChannel?.key;
  const visibleSeries = useMemo(() => getVisibleYChannels(chartConfig), [chartConfig]);
  const processing = useMemo(
    () => ({
      processedData: processedDisplay.displayedData,
      comparisonData: filterActive && chartConfig.dataFilter.showOriginal ? displayedData : undefined,
      filterActive,
    }),
    [chartConfig.dataFilter.showOriginal, displayedData, filterActive, processedDisplay.displayedData]
  );
  const analysisData = processing.processedData;
  const latestPoint = analysisData[analysisData.length - 1];

  const chartDataFormatted = useMemo(() => {
    if (chartConfig.chartType === "waveform" || analysisData.length === 0) return [];
    // 传入实际可见的通道，让包络只跟踪画出来的那几路的极值
    const keys = visibleSeries.map((item) => item.key);
    if (xChannel) keys.push(xChannel.key);
    return buildChartDisplayRows(analysisData, chartConfig.visiblePointLimit, keys);
  }, [analysisData, chartConfig.chartType, chartConfig.visiblePointLimit, visibleSeries, xChannel]);

  const yAxisDomain = useMemo(() => {
    if (chartConfig.chartType === "waveform" || analysisData.length === 0) return [0, 100];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    analysisData.forEach((point) => {
      Object.entries(point.values).forEach(([key, value]) => {
        if (chartConfig.chartType === "xy-scatter" && key === xChannelKey) return;
        if (typeof value === "number" && Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      });
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 100];
    if (min === max) {
      const padding = Math.abs(min) * 0.1 || 10;
      return [min - padding, max + padding];
    }
    const margin = (max - min) * 0.1;
    return [min - margin, max + margin];
  }, [analysisData, chartConfig.chartType, xChannelKey]);

  const xAxisDomain = useMemo(() => {
    if (chartConfig.chartType !== "xy-scatter" || !xChannelKey) return undefined;
    if (analysisData.length === 0) return [0, 100];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    analysisData.forEach((point) => {
      const value = point.values[xChannelKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 100];
    if (min === max) {
      const padding = Math.abs(min) * 0.1 || 10;
      return [min - padding, max + padding];
    }
    const margin = (max - min) * 0.1;
    return [min - margin, max + margin];
  }, [analysisData, chartConfig.chartType, xChannelKey]);

  const statistics = useMemo(
    () => calculateChartStatistics(analysisData, visibleSeries),
    [analysisData, visibleSeries]
  );

  const parseHealth = useMemo(() => {
    const total = parseSuccessCount + parseFailCount;
    if (total === 0) return null;
    return (parseSuccessCount / total) * 100;
  }, [parseFailCount, parseSuccessCount]);

  const seriesInspectorEntries = useMemo<ChannelInspectorEntry[]>(() => {
    const keys = new Set<string>();
    chartConfig.channels.forEach((channel) => keys.add(channel.key));
    if (latestPoint) {
      Object.keys(latestPoint.values).forEach((key) => keys.add(key));
    }
    const channelMap = new Map(chartConfig.channels.map((channel) => [channel.key, channel]));
    return Array.from(keys)
      .map((key, index) => {
        const channel = channelMap.get(key);
        const rawValue = latestPoint?.values[key];
        return {
          key,
          name: channel?.name ?? key,
          color: channel?.color ?? fallbackChannelColor(index),
          visible: channel?.visible ?? false,
          unit: channel?.unit ?? "",
          latestValue: typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null,
          configured: Boolean(channel),
          role: (channel?.role ?? "y") as "x" | "y",
        };
      })
      .sort((left, right) => {
        if (left.configured !== right.configured) {
          return Number(right.configured) - Number(left.configured);
        }
        if (left.visible !== right.visible) {
          return Number(right.visible) - Number(left.visible);
        }
        return left.key.localeCompare(right.key);
      });
  }, [chartConfig.channels, latestPoint]);

  const updateSignalDomain = (domain: SignalDomain) => {
    setChartConfig({
      ...chartConfig,
      chartType: "waveform",
      signalDomain: domain,
    });
  };

  const handleExportCsv = async (mode: "processed" | "raw" | "comparison") => {
    const data = mode === "raw" ? displayedData : analysisData;
    if (data.length === 0) return;
    try {
      const path = await exportChartDataAsCsv(data, chartConfig, {
        comparisonData: mode === "comparison" ? displayedData : undefined,
        filenamePrefix: filterActive ? `chart-${mode}` : "chart",
      });
      if (path) {
        const label = filterActive ? (mode === "raw" ? "原始" : mode === "comparison" ? "对照" : "处理后") : "";
        addLog("success", `图表${label}数据已导出: ${path}`);
      }
    } catch (err) {
      addLog("error", `导出 CSV 失败: ${err}`);
    }
  };

  const handleExportPng = async () => {
    if (displayedData.length === 0) return;
    const container = chartContainerRef.current;
    if (!container) return;
    try {
      const canvas = container.querySelector<HTMLCanvasElement>("canvas");
      if (canvas) {
        const path = await exportCanvasAsPng(canvas);
        if (path) addLog("success", `图表图像已导出: ${path}`);
        return;
      }
      const svg = container.querySelector<SVGSVGElement>("svg");
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const path = await exportSvgAsPng(
          svg,
          Math.max(Math.round(rect.width), 1),
          Math.max(Math.round(rect.height), 1)
        );
        if (path) addLog("success", `图表图像已导出: ${path}`);
        return;
      }
      addLog("warn", "未找到可导出的图表元素");
    } catch (err) {
      addLog("error", `导出 PNG 失败: ${err}`);
    }
  };

  const handleClearData = () => {
    frozenChartDataRef.current = [];
    frozenProcessedDataRef.current = [];
    clearChartData();
  };

  const updateChannelConfig = (channelKey: string, updater: (channel: Channel) => Channel) => {
    setChartConfig({
      ...chartConfig,
      channels: chartConfig.channels.map((channel) => (channel.key === channelKey ? updater(channel) : channel)),
    });
  };

  const addChannelFromField = (entry: ChannelInspectorEntry, overrides: Partial<Channel> = {}) => {
    const existing = chartConfig.channels.find((channel) => channel.key === entry.key);
    if (existing) {
      if (Object.keys(overrides).length === 0) return;
      setChartConfig({
        ...chartConfig,
        channels: chartConfig.channels.map((channel) =>
          channel.key === entry.key ? { ...channel, ...overrides } : channel
        ),
      });
      return;
    }

    setChartConfig({
      ...chartConfig,
      channels: [
        ...chartConfig.channels,
        {
          key: entry.key,
          name: entry.name,
          color: entry.color || PRESET_COLORS[chartConfig.channels.length % PRESET_COLORS.length],
          visible: true,
          unit: entry.unit,
          role: "y",
          ...overrides,
        },
      ],
    });
  };

  const renderBusinessChart = () => {
    if (chartConfig.chartType === "line") {
      return (
        <LineChart data={chartDataFormatted}>
          {chartConfig.showGrid && <CartesianGrid strokeDasharray="3 3" />}
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12 }}
            label={{ value: "时间 (s)", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            domain={yAxisDomain}
            label={{ value: "数值", angle: -90, position: "insideLeft" }}
          />
          {chartConfig.showTooltip && <Tooltip />}
          {chartConfig.showLegend && <Legend />}
          <Brush
            dataKey="index"
            height={28}
            stroke="#5f82ff"
            startIndex={zoomDomain.startIndex}
            endIndex={zoomDomain.endIndex}
            onChange={(domain) => setZoomDomain(domain || {})}
          />
          {visibleSeries.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              stroke={series.color}
              name={series.name}
              dot={false}
              strokeWidth={2}
              isAnimationActive={chartConfig.animationEnabled}
            />
          ))}
        </LineChart>
      );
    }

    if (chartConfig.chartType === "bar") {
      return (
        <BarChart data={chartDataFormatted}>
          {chartConfig.showGrid && <CartesianGrid strokeDasharray="3 3" />}
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12 }}
            label={{ value: "时间 (s)", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            domain={yAxisDomain}
            label={{ value: "数值", angle: -90, position: "insideLeft" }}
          />
          {chartConfig.showTooltip && <Tooltip />}
          {chartConfig.showLegend && <Legend />}
          <Brush
            dataKey="index"
            height={28}
            stroke="#5f82ff"
            startIndex={zoomDomain.startIndex}
            endIndex={zoomDomain.endIndex}
            onChange={(domain) => setZoomDomain(domain || {})}
          />
          {visibleSeries.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              fill={series.color}
              name={series.name}
              isAnimationActive={chartConfig.animationEnabled}
            />
          ))}
        </BarChart>
      );
    }

    if (chartConfig.chartType === "xy-scatter") {
      return (
        <ScatterChart data={chartDataFormatted}>
          {chartConfig.showGrid && <CartesianGrid strokeDasharray="3 3" />}
          <XAxis
            type="number"
            dataKey={xChannelKey || "index"}
            domain={xAxisDomain || ["auto", "auto"]}
            tick={{ fontSize: 12 }}
            label={{ value: xChannel?.name || xChannelKey || "X", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            type="number"
            tick={{ fontSize: 12 }}
            domain={yAxisDomain}
            label={{ value: "Y", angle: -90, position: "insideLeft" }}
          />
          {chartConfig.showTooltip && <Tooltip />}
          {chartConfig.showLegend && <Legend />}
          <Brush
            dataKey="index"
            height={28}
            stroke="#5f82ff"
            startIndex={zoomDomain.startIndex}
            endIndex={zoomDomain.endIndex}
            onChange={(domain) => setZoomDomain(domain || {})}
          />
          {visibleSeries.map((series) => (
            <Scatter
              key={series.key}
              dataKey={series.key}
              fill={series.color}
              name={series.name}
              isAnimationActive={chartConfig.animationEnabled}
            />
          ))}
        </ScatterChart>
      );
    }

    return (
      <ScatterChart data={chartDataFormatted}>
        {chartConfig.showGrid && <CartesianGrid strokeDasharray="3 3" />}
        <XAxis
          dataKey="time"
          tick={{ fontSize: 12 }}
          label={{ value: "时间 (s)", position: "insideBottom", offset: -5 }}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          domain={yAxisDomain}
          label={{ value: "数值", angle: -90, position: "insideLeft" }}
        />
        {chartConfig.showTooltip && <Tooltip />}
        {chartConfig.showLegend && <Legend />}
        <Brush
          dataKey="index"
          height={28}
          stroke="#5f82ff"
          startIndex={zoomDomain.startIndex}
          endIndex={zoomDomain.endIndex}
          onChange={(domain) => setZoomDomain(domain || {})}
        />
        {visibleSeries.map((series) => (
          <Scatter
            key={series.key}
            dataKey={series.key}
            fill={series.color}
            name={series.name}
            isAnimationActive={chartConfig.animationEnabled}
          />
        ))}
      </ScatterChart>
    );
  };

  if (!chartConfig.enabled) {
    return (
      <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-border/80 bg-white/55">
        <div className="space-y-2 text-center">
          <p className="text-base font-medium text-foreground">图表尚未配置</p>
          <p className="text-xs text-muted-foreground">
            请到右侧“数据”页粘贴一条真实样本，确认识别出数值通道后点击“应用解析”。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-[32px] border border-border/60 bg-white/80 p-4 shadow-[0_20px_45px_rgba(56,72,108,0.12)] backdrop-blur-xl">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 rounded-[24px] border border-border/50 bg-secondary/70 px-3.5 py-2.5">
        <Button
          size="sm"
          variant={chartPaused ? "secondary" : "outline"}
          onClick={() => setChartPaused(!chartPaused)}
          className="gap-1"
        >
          {chartPaused ? (
            <>
              <Play className="h-3.5 w-3.5" />
              恢复跟随
            </>
          ) : (
            <>
              <Snowflake className="h-3.5 w-3.5" />
              冻结
            </>
          )}
        </Button>

        <span className="h-5 w-px bg-border/70" aria-hidden />

        <Button size="sm" variant="outline" onClick={handleClearData} className="gap-1">
          <Trash2 className="h-3.5 w-3.5" />
          清空数据
        </Button>

        <span className="h-5 w-px bg-border/70" aria-hidden />

        {chartConfig.chartType === "waveform" && (
          <>
            <div className="flex items-center gap-1 rounded-full bg-white/85 p-1 shadow-sm">
              <Button
                size="sm"
                variant={signalDomain === "time" ? "default" : "ghost"}
                onClick={() => updateSignalDomain("time")}
                className="h-7 rounded-full px-3"
              >
                时域
              </Button>
              <Button
                size="sm"
                variant={signalDomain === "fft" ? "default" : "ghost"}
                onClick={() => updateSignalDomain("fft")}
                className="h-7 rounded-full px-3"
              >
                FFT
              </Button>
            </div>
          </>
        )}

        {statistics && Object.keys(statistics).length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1">
                <Info className="h-3.5 w-3.5" />
                统计
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 rounded-[24px]">
              <div className="space-y-3">
                <h4 className="text-sm font-medium">数据统计</h4>
                {visibleSeries.map((series) => {
                  const stat = statistics[series.key];
                  if (!stat) return null;
                  return (
                    <div key={series.key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: series.color }} />
                        <span className="text-sm font-medium">{series.name}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pl-5 text-xs text-muted-foreground">
                        <div>最小值: {formatChartNumber(stat.min)}</div>
                        <div>最大值: {formatChartNumber(stat.max)}</div>
                        <div>平均值: {formatChartNumber(stat.avg)}</div>
                        <div>当前值: {formatChartNumber(stat.latest)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Settings2 className="h-3.5 w-3.5" />
              通道
              <span className="rounded-full bg-secondary px-1.5 text-[11px] text-secondary-foreground">
                {seriesInspectorEntries.length}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] rounded-[24px] p-0">
            <div className="border-b border-border/60 px-4 py-3">
              <div className="text-sm font-medium text-foreground">数据通道</div>
              <div className="text-xs text-muted-foreground">查看实时值、修改名称和控制曲线显隐</div>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
              {seriesInspectorEntries.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
                  解析到数值字段后，这里会显示可用通道。
                </div>
              ) : (
                seriesInspectorEntries.map((series) => (
                  <div key={series.key} className="rounded-[20px] border border-border/60 bg-white/80 p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                      <Input
                        value={series.name}
                        onChange={(event) => {
                          const nextName = event.target.value || series.key;
                          if (series.configured) {
                            updateChannelConfig(series.key, (item) => ({ ...item, name: nextName }));
                            return;
                          }
                          addChannelFromField({ ...series, name: nextName }, { name: nextName, visible: false });
                        }}
                        placeholder={series.key}
                        className="h-8 text-sm"
                      />
                      {series.configured ? (
                        <Switch
                          checked={series.visible}
                          onCheckedChange={(visible) =>
                            updateChannelConfig(series.key, (item) => ({ ...item, visible }))
                          }
                        />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 gap-1 px-2"
                          onClick={() => addChannelFromField(series)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          加入
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{series.key}</span>
                      <span className="text-right text-sm font-semibold text-foreground">
                        {series.latestValue === null ? "—" : formatChartNumber(series.latestValue)}
                        {series.unit ? <span className="ml-1 text-xs text-muted-foreground">{series.unit}</span> : null}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={displayedData.length === 0} className="gap-1">
              <Download className="h-3.5 w-3.5" />
              导出
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 rounded-[18px] p-2">
            <div className="grid gap-1">
              {filterActive ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => handleExportCsv("processed")}
                  >
                    导出处理后数据
                  </Button>
                  <Button size="sm" variant="ghost" className="justify-start" onClick={() => handleExportCsv("raw")}>
                    导出原始数据
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => handleExportCsv("comparison")}
                  >
                    导出前后对照
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => handleExportCsv("processed")}
                >
                  导出 CSV 数据
                </Button>
              )}
              <Button size="sm" variant="ghost" className="justify-start" onClick={handleExportPng}>
                导出 PNG 图像
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground tabular-nums">
          {chartPaused && <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">已冻结</span>}
          <span className="rounded-full bg-white/80 px-3 py-1">
            解析 {parseHealth === null ? "—" : `${parseHealth.toFixed(0)}%`}
          </span>
        </div>
      </div>

      <div ref={chartContainerRef} className="min-h-[360px] flex-1">
        {displayedData.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-border/80 bg-white/55">
            <div className="max-w-xl space-y-2 px-6 text-center">
              <p className="text-sm font-medium text-foreground">还没有可绘制的数据</p>
              <p className="text-xs text-muted-foreground">
                先到右侧“数据”页粘贴一条真实样本，确认识别出数值通道并点击“应用解析”。
              </p>
              <p className="text-xs text-muted-foreground">
                然后连接数据源并开始接收；匹配的数据到达后会自动生成图表。
              </p>
            </div>
          </div>
        ) : visibleSeries.length === 0 ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-border/80 bg-white/55">
            <div className="space-y-2 text-center">
              <p className="text-sm font-medium text-foreground">当前没有可见曲线</p>
              <p className="text-xs text-muted-foreground">
                可在右侧“数据”页重新粘贴样本并应用解析，或从图表工具栏“通道”打开已有曲线。
              </p>
            </div>
          </div>
        ) : chartConfig.chartType === "waveform" ? (
          <SignalPlotCanvas
            chartData={analysisData}
            rawChartData={processing.comparisonData}
            filterActive={processing.filterActive}
            series={visibleSeries}
            chartConfig={chartConfig}
            domain={signalDomain}
            onChartConfigChange={setChartConfig}
            triggeredAt={triggeredAt}
          />
        ) : (
          <div className="h-full min-h-[320px] rounded-[28px] border border-border/60 bg-white/80 p-3">
            <ResponsiveContainer width="100%" height="100%">
              {renderBusinessChart()}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
