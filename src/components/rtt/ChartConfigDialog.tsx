import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Channel,
  ChartConfig,
  ChartType,
  DataFilterKind,
  ParametricFilterStage,
  ParametricFilterType,
  ParseMode,
  WaveformInterpolation,
} from "@/lib/chartTypes";
import {
  isBytesParseMode,
  isModbusParseMode,
  MAX_CHART_DATA_POINTS,
  MIN_CHART_DATA_POINTS,
  PRESET_COLORS,
} from "@/lib/chartTypes";
import { createBinaryProtocolChannels, listChartParsers } from "@/lib/parseChartData";
import {
  populateEmptyChannelsFromSamples,
  previewChartParser,
  resolveAppliedParserChannels,
  type ChartSample,
} from "@/lib/chartAnalysis";
import {
  calculateSosFrequencyResponse,
  designParametricSos,
  formatMatlabSos,
  formatMatlabVector,
  parseMatlabSos,
  parseMatlabVector,
} from "@/lib/chartFilter";
import { exportJson } from "@/lib/exporters";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Download, Eye, EyeOff, GripVertical, Plus, Settings, Trash2 } from "lucide-react";
import { BinaryProtocolDesigner } from "@/components/serial/BinaryProtocolDesigner";

type ChartConfigSection = "basic" | "channels" | "performance" | "display" | "filter";

export interface ChartConfigDialogProps {
  chartConfig: ChartConfig;
  setChartConfig: (config: ChartConfig) => void;
  trigger?: React.ReactNode;
  title?: string;
  /** 数据源能否提供原始字节流。为 false 时隐藏字节流解析器——文本行已过分帧解码，还原不回字节。 */
  allowBytesParsers?: boolean;
  allowDataFilter?: boolean;
  allowParserConfig?: boolean;
  initialSection?: ChartConfigSection;
  samples?: ChartSample[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ChartConfigDialog({
  chartConfig,
  setChartConfig,
  trigger,
  title = "图表配置",
  allowBytesParsers = false,
  allowDataFilter = false,
  allowParserConfig = true,
  initialSection = "basic",
  samples = [],
  open: controlledOpen,
  onOpenChange,
}: ChartConfigDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<ChartConfig>(chartConfig);
  const [activeSection, setActiveSection] = useState<ChartConfigSection>(initialSection);
  const [firText, setFirText] = useState("");
  const [sosText, setSosText] = useState("");
  const [scaleText, setScaleText] = useState("1");
  const [filterError, setFilterError] = useState("");
  const [channelHint, setChannelHint] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const draggedStageId = useRef<string | null>(null);
  const open = controlledOpen ?? internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (open && !wasOpen.current) {
      const nextConfig = populateEmptyChannelsFromSamples(chartConfig, samples);
      setLocalConfig(nextConfig);
      setActiveSection(initialSection === "filter" && !allowDataFilter ? "basic" : initialSection);
      setFirText(formatMatlabVector(nextConfig.dataFilter.firCoefficients));
      setSosText(formatMatlabSos(nextConfig.dataFilter.sosSections));
      setScaleText(formatMatlabVector(nextConfig.dataFilter.scaleValues));
      setSelectedStageId(nextConfig.dataFilter.parametricStages[0]?.id ?? null);
      setFilterError("");
      const sample = nextConfig.framePrefix
        ? [...samples].reverse().find(({ text }) => text.startsWith(nextConfig.framePrefix))
        : samples[samples.length - 1];
      setSampleText(sample?.text ?? "");
      setChannelHint(
        chartConfig.channels.length > 0
          ? ""
          : nextConfig.channels.length > 0
            ? `已根据当前缓冲区预建 ${nextConfig.channels.length} 个通道。`
            : samples.length > 0
              ? "当前缓冲区未能按所选解析模式识别出数值通道，可手动添加。"
              : "当前缓冲区暂无可用于预建通道的数据。"
      );
    }
    wasOpen.current = open;
  }, [allowDataFilter, chartConfig, initialSection, open, samples]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  const handleSave = () => {
    let nextConfig = localConfig;
    const filter = localConfig.dataFilter;
    if (allowDataFilter && filter.enabled) {
      if (filter.kind !== "median" && filter.sampleRateHz <= 0) {
        setFilterError(
          filter.kind === "cascade"
            ? "请输入参数化滤波器使用的采样率 Fs。"
            : "请输入 MATLAB 设计滤波器时使用的采样率 Fs。"
        );
        setActiveSection("filter");
        return;
      }
      if (filter.kind === "fir") {
        const coefficients = parseMatlabVector(firText);
        if (coefficients.length === 0) {
          setFilterError("FIR 系数不能为空，请粘贴 MATLAB 导出的 b 向量。");
          setActiveSection("filter");
          return;
        }
        nextConfig = { ...localConfig, dataFilter: { ...filter, firCoefficients: coefficients } };
      } else if (filter.kind === "sos") {
        const sections = parseMatlabSos(sosText);
        if (!sections) {
          setFilterError("SOS 必须由 6 个系数一组组成，且每组 a0 不能为 0。");
          setActiveSection("filter");
          return;
        }
        const scaleValues = parseMatlabVector(scaleText);
        nextConfig = {
          ...localConfig,
          dataFilter: { ...filter, sosSections: sections, scaleValues: scaleValues.length > 0 ? scaleValues : [1] },
        };
      } else if (filter.kind === "cascade") {
        if (filter.parametricStages.length === 0) {
          setFilterError("请至少添加一级参数化滤波器。");
          setActiveSection("filter");
          return;
        }
        const invalidIndex = filter.parametricStages.findIndex(
          (stage) =>
            !Number.isFinite(stage.frequencyHz) ||
            stage.frequencyHz <= 0 ||
            stage.frequencyHz >= filter.sampleRateHz / 2 ||
            !Number.isFinite(stage.q) ||
            stage.q <= 0
        );
        if (invalidIndex >= 0) {
          setFilterError(`第 ${invalidIndex + 1} 级参数无效：频率必须低于 Nyquist，Q 必须大于 0。`);
          setActiveSection("filter");
          return;
        }
      }
    }
    if (localConfig.parseMode === "regex" && nextConfig.channels.length === 0 && regexPreview?.success) {
      nextConfig = { ...nextConfig, channels: regexPreview.config.channels };
    }
    setChartConfig(nextConfig);
    setOpen(false);
  };

  const isDelimiter =
    localConfig.parseMode === "delimiter" ||
    localConfig.parseMode === "justfloat" ||
    isModbusParseMode(localConfig.parseMode) ||
    localConfig.parseMode === "auto";
  const sourceIndexLabel =
    localConfig.parseMode === "justfloat"
      ? "浮点序号"
      : isModbusParseMode(localConfig.parseMode)
        ? "寄存器值序号"
        : "列号";
  const isXyScatter = localConfig.chartType === "xy-scatter";
  const regexPreview = useMemo(
    () => (localConfig.parseMode === "regex" ? previewChartParser(localConfig, samples, sampleText) : undefined),
    [localConfig, sampleText, samples]
  );

  const updateDataFilter = (patch: Partial<ChartConfig["dataFilter"]>) => {
    setFilterError("");
    setLocalConfig((current) => ({
      ...current,
      dataFilter: { ...current.dataFilter, ...patch },
    }));
  };

  const updateParametricStage = (index: number, patch: Partial<ParametricFilterStage>) => {
    updateDataFilter({
      parametricStages: localConfig.dataFilter.parametricStages.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, ...patch } : stage
      ),
    });
  };

  const addParametricStage = (afterIndex: number) => {
    const stage: ParametricFilterStage = {
      id: crypto.randomUUID(),
      type: "lowpass",
      enabled: true,
      frequencyHz: Math.min(10, localConfig.dataFilter.sampleRateHz / 4 || 10),
      q: Math.SQRT1_2,
    };
    const stages = localConfig.dataFilter.parametricStages.slice();
    stages.splice(afterIndex + 1, 0, stage);
    updateDataFilter({
      parametricStages: stages,
    });
    setSelectedStageId(stage.id);
  };

  const moveParametricStage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= localConfig.dataFilter.parametricStages.length) return;
    const stages = localConfig.dataFilter.parametricStages.slice();
    [stages[index], stages[target]] = [stages[target], stages[index]];
    updateDataFilter({ parametricStages: stages });
  };

  const moveParametricStageTo = (stageId: string, targetIndex: number) => {
    const stages = localConfig.dataFilter.parametricStages.slice();
    const sourceIndex = stages.findIndex((stage) => stage.id === stageId);
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const [stage] = stages.splice(sourceIndex, 1);
    stages.splice(targetIndex, 0, stage);
    updateDataFilter({ parametricStages: stages });
  };

  const removeParametricStage = (index: number) => {
    const stages = localConfig.dataFilter.parametricStages.filter((_, stageIndex) => stageIndex !== index);
    updateDataFilter({ parametricStages: stages });
    setSelectedStageId(stages[Math.min(index, stages.length - 1)]?.id ?? null);
  };

  const exportParametricStages = async () => {
    const filter = localConfig.dataFilter;
    const sosSections = designParametricSos(filter.parametricStages, filter.sampleRateHz);
    if (!sosSections) {
      setFilterError("请先填写有效的采样率和滤波级参数，再导出。");
      return;
    }
    try {
      await exportJson(
        JSON.stringify(
          {
            format: "MICU-OmniProbe parametric cascade",
            version: 1,
            sampleRateHz: filter.sampleRateHz,
            stages: filter.parametricStages,
            sosSections,
            scaleValues: [1],
          },
          null,
          2
        ),
        "omniprobe-filter.json"
      );
    } catch (error) {
      setFilterError(`导出失败：${String(error)}`);
    }
  };

  const updateChannel = (index: number, patch: Partial<Channel>) => {
    setLocalConfig((current) => {
      const next = current.channels.map((channel, i) => (i === index ? { ...channel, ...patch } : channel));
      // role 切到 x 时确保只保留一个 x
      if (patch.role === "x") {
        for (let i = 0; i < next.length; i += 1) {
          if (i !== index && next[i].role === "x") {
            next[i] = { ...next[i], role: "y" };
          }
        }
      }
      return { ...current, channels: next };
    });
  };

  const addChannel = () => {
    setLocalConfig((current) => {
      const usedKeys = new Set(current.channels.map((c) => c.key));
      const baseKey = "ch";
      let suffix = current.channels.length + 1;
      while (usedKeys.has(`${baseKey}${suffix}`)) suffix += 1;
      const key = `${baseKey}${suffix}`;
      return {
        ...current,
        channels: [
          ...current.channels,
          {
            key,
            name: key,
            color: PRESET_COLORS[current.channels.length % PRESET_COLORS.length],
            visible: true,
            role: "y",
            ...(current.parseMode === "slcan"
              ? {
                  can: {
                    frameId: 0x100,
                    extended: false,
                    startBit: Math.min(current.channels.length * 8, 63),
                    bitLength: 8,
                    byteOrder: "little" as const,
                    signed: false,
                    factor: 1,
                    offset: 0,
                  },
                }
              : {}),
            sourceIndex:
              current.parseMode === "delimiter" ||
              current.parseMode === "justfloat" ||
              isModbusParseMode(current.parseMode)
                ? current.channels.length
                : undefined,
          },
        ],
      };
    });
  };

  const removeChannel = (index: number) => {
    setLocalConfig((current) => ({
      ...current,
      channels: current.channels.filter((_, i) => i !== index),
    }));
  };

  const moveChannel = (index: number, direction: -1 | 1) => {
    setLocalConfig((current) => {
      const next = current.channels.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, channels: next };
    });
  };

  const parseModeHint = useMemo(() => {
    switch (localConfig.parseMode) {
      case "delimiter":
        return "按分隔符切列。下方每条通道用「列号」指定从分隔后的第几列读取。";
      case "regex":
        return "用命名捕获组提取数值，如 (?<temp>\\d+\\.\\d+)。通道的 key 必须与捕获组同名。";
      case "json":
        return "整行作为 JSON 解析，按通道 key 取数值字段。通道留空时自动提取全部数值字段。";
      case "kv":
        return "自动提取行内所有 key=value 或 key:value 数值对。通道留空时全部保留，否则只保留命中的 key。";
      case "justfloat":
        return "解析 VOFA JustFloat：little-endian float32 数组，以 00 00 80 7F 结束。通道留空时按首帧自动生成。";
      case "binary":
        return "按协议设计器配置，从原始字节流完成分帧、消息匹配、CRC 校验和字段解码。";
      case "slcan":
        return "解析 SLCAN 经典 CAN t/T/r/R 与 CAN FD d/D/b/B 帧；信号与 DBC 请在串口侧栏的数据解析面板配置。";
      case "modbus-rtu":
      case "modbus-ascii":
      case "modbus-tcp":
        return "解析 Modbus 03/04 响应；主站轮询参数请在串口侧栏的数据解析面板配置。";
      case "auto":
        return "依次尝试 JSON → 正则 → KV → 分隔符。任意一种成功即停止。";
      default:
        return "";
    }
  }, [localConfig.parseMode]);

  const selectedStageIndex = localConfig.dataFilter.parametricStages.findIndex((stage) => stage.id === selectedStageId);
  const selectedStage = localConfig.dataFilter.parametricStages[selectedStageIndex];

  const filterFields = (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-[18px] border border-border/60 px-3 py-2.5">
        <div>
          <Label>启用数据滤波</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            应用于波形、FFT 和图表统计；原始日志、CSV 导出和 AI 数据保持不变。
          </p>
        </div>
        <Switch checked={localConfig.dataFilter.enabled} onCheckedChange={(enabled) => updateDataFilter({ enabled })} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>执行函数</Label>
          <Select
            value={localConfig.dataFilter.kind}
            onValueChange={(kind: DataFilterKind) => updateDataFilter({ kind })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sos">IIR · SOS + ScaleValues</SelectItem>
              <SelectItem value="fir">FIR · b 系数</SelectItem>
              <SelectItem value="median">实时中值滤波</SelectItem>
              <SelectItem value="cascade">参数化级联</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {localConfig.dataFilter.kind !== "median" && (
          <NumberField
            id="filterSampleRateHz"
            label={localConfig.dataFilter.kind === "cascade" ? "滤波采样率 Fs (Hz)" : "MATLAB 设计采样率 Fs (Hz)"}
            value={localConfig.dataFilter.sampleRateHz}
            onChange={(sampleRateHz) => updateDataFilter({ sampleRateHz: Math.max(sampleRateHz, 0) })}
          />
        )}
      </div>

      {localConfig.dataFilter.kind === "fir" && (
        <MatlabTextField
          id="firCoefficients"
          label="FIR 系数 b"
          value={firText}
          placeholder="[0.1 0.2 0.4 0.2 0.1]"
          onChange={(value) => {
            setFilterError("");
            setFirText(value);
          }}
        />
      )}

      {localConfig.dataFilter.kind === "sos" && (
        <div className="space-y-3">
          <MatlabTextField
            id="sosSections"
            label="SOS Matrix（每行 b0 b1 b2 a0 a1 a2）"
            value={sosText}
            placeholder={"1 2 1 1 -1.8 0.81;\n1 2 1 1 -1.6 0.64"}
            onChange={(value) => {
              setFilterError("");
              setSosText(value);
            }}
          />
          <MatlabTextField
            id="scaleValues"
            label="g / ScaleValues（留空按 1）"
            value={scaleText}
            placeholder="1"
            rows={2}
            onChange={(value) => {
              setFilterError("");
              setScaleText(value);
            }}
          />
        </div>
      )}

      {localConfig.dataFilter.kind === "median" && (
        <NumberField
          id="medianWindowSize"
          label="窗口大小（奇数，3-255）"
          value={localConfig.dataFilter.medianWindowSize}
          onChange={(value) => {
            const clamped = Math.min(Math.max(Math.round(value), 3), 255);
            updateDataFilter({ medianWindowSize: clamped % 2 === 0 ? Math.min(clamped + 1, 255) : clamped });
          }}
        />
      )}

      {localConfig.dataFilter.kind === "cascade" && (
        <div className="space-y-4">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">滤波器链</div>
              <p className="text-xs text-muted-foreground">
                从上到下依次执行；点击滤波级编辑，拖动滤波级排序
                {localConfig.dataFilter.sampleRateHz > 0
                  ? `；频率必须低于 ${(localConfig.dataFilter.sampleRateHz / 2).toFixed(2)} Hz`
                  : ""}
                。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={exportParametricStages}
                disabled={localConfig.dataFilter.parametricStages.length === 0}
                className="gap-1"
              >
                <Download className="h-3.5 w-3.5" />
                导出参数
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  addParametricStage(
                    selectedStageIndex >= 0 ? selectedStageIndex : localConfig.dataFilter.parametricStages.length - 1
                  )
                }
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                添加滤波级
              </Button>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
            <div className="min-w-0">
              {localConfig.dataFilter.parametricStages.length > 0 ? (
                <div className="max-h-[22rem] space-y-2 overflow-y-auto rounded-[18px] border border-border/60 bg-muted/10 p-2">
                  {localConfig.dataFilter.parametricStages.map((stage, index) => (
                    <button
                      key={stage.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        draggedStageId.current = stage.id;
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        draggedStageId.current = null;
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (draggedStageId.current) moveParametricStageTo(draggedStageId.current, index);
                      }}
                      onClick={() => setSelectedStageId(stage.id)}
                      className={`flex w-full min-w-0 items-center gap-2 rounded-[14px] border px-3 py-2 text-left transition-colors ${
                        selectedStageId === stage.id
                          ? "border-primary bg-primary/10"
                          : "border-border/70 bg-background hover:border-primary/50"
                      } ${stage.enabled ? "" : "opacity-50"}`}
                      aria-pressed={selectedStageId === stage.id}
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{parametricTypeLabel(stage.type)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatFrequency(stage.frequencyHz)} · Q {stage.q.toFixed(2)}
                        </span>
                      </span>
                      {stage.enabled ? (
                        <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-[18px] border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                  还没有滤波级，点击“添加滤波级”开始配置。
                </div>
              )}
            </div>

            {selectedStage ? (
              <div className="min-w-0 rounded-[18px] border border-border/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">第 {selectedStageIndex + 1} 级参数</span>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedStage.enabled}
                        onCheckedChange={(enabled) => updateParametricStage(selectedStageIndex, { enabled })}
                      />
                      <span className="text-xs text-muted-foreground">
                        {selectedStage.enabled ? "参与级联" : "已旁路"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={selectedStageIndex === 0}
                      onClick={() => moveParametricStage(selectedStageIndex, -1)}
                      aria-label="上移滤波级"
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={selectedStageIndex === localConfig.dataFilter.parametricStages.length - 1}
                      onClick={() => moveParametricStage(selectedStageIndex, 1)}
                      aria-label="下移滤波级"
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => removeParametricStage(selectedStageIndex)}
                      aria-label="删除滤波级"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>类型</Label>
                    <Select
                      value={selectedStage.type}
                      onValueChange={(type: ParametricFilterType) =>
                        updateParametricStage(selectedStageIndex, { type })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lowpass">低通</SelectItem>
                        <SelectItem value="highpass">高通</SelectItem>
                        <SelectItem value="bandpass">带通</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField
                    id={`parametric-frequency-${selectedStage.id}`}
                    label={selectedStage.type === "bandpass" ? "中心频率 (Hz)" : "截止频率 (Hz)"}
                    value={selectedStage.frequencyHz}
                    min={0.001}
                    onChange={(frequencyHz) => updateParametricStage(selectedStageIndex, { frequencyHz })}
                  />
                  <NumberField
                    id={`parametric-q-${selectedStage.id}`}
                    label="Q 值"
                    value={selectedStage.q}
                    min={0.001}
                    step={0.01}
                    onChange={(q) => updateParametricStage(selectedStageIndex, { q })}
                  />
                </div>
                {selectedStage.type === "bandpass" && selectedStage.q > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    近似带宽 {(selectedStage.frequencyHz / selectedStage.q).toFixed(2)} Hz；Q 越大，通带越窄。
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-[18px] border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                添加或选择一个滤波级后编辑参数。
              </div>
            )}
          </div>

          <FrequencyResponsePreview
            stages={localConfig.dataFilter.parametricStages}
            selectedStage={selectedStage}
            sampleRateHz={localConfig.dataFilter.sampleRateHz}
          />
        </div>
      )}

      <ToggleRow
        label="叠加显示原始曲线"
        checked={localConfig.dataFilter.showOriginal}
        onCheckedChange={(showOriginal) => updateDataFilter({ showOriginal })}
      />

      {filterError && <p className="text-sm text-destructive">{filterError}</p>}
      <p className="text-xs leading-5 text-muted-foreground">
        Filter Designer 可通过 <code className="font-mono">filterDesigner</code> 打开。高阶 IIR 推荐导出 SOS Matrix 与
        ScaleValues；参数 Fs 与实际采样率不一致时，波形会显示提醒。
      </p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" variant="outline" className="gap-1">
              <Settings className="h-3.5 w-3.5" />
              配置图表
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[calc(100vh-1rem)] max-w-5xl overflow-y-auto"
        style={{ width: "min(calc(100vw - 1rem), 64rem)" }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2 rounded-[20px] border border-border/60 bg-muted/20 p-2">
            {(
              [
                ["basic", "基础"],
                ["channels", "通道"],
                ["performance", "性能与采样"],
                ["display", "显示"],
                ...(allowDataFilter ? [["filter", "滤波"]] : []),
              ] as Array<[ChartConfigSection, string]>
            ).map(([section, label]) => (
              <Button
                key={section}
                size="sm"
                variant={activeSection === section ? "default" : "ghost"}
                onClick={() => setActiveSection(section)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* 1. 启用 + 解析模式 + 图表类型 */}
          {activeSection === "basic" && (
            <section className="rounded-[24px] border border-border/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">基础</div>
                  <p className="text-xs text-muted-foreground">关闭后停止结构化数据解析；原始日志仍继续接收。</p>
                </div>
                <Switch
                  checked={localConfig.enabled}
                  onCheckedChange={(checked) => setLocalConfig({ ...localConfig, enabled: checked })}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {allowParserConfig && (
                  <div className="space-y-2">
                    <Label htmlFor="parseMode">解析模式</Label>
                    <Select
                      value={localConfig.parseMode}
                      onValueChange={(value: ParseMode) => setLocalConfig({ ...localConfig, parseMode: value })}
                    >
                      <SelectTrigger id="parseMode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自动</SelectItem>
                        {listChartParsers()
                          .filter(
                            (parser) => !isModbusParseMode(parser.id) && (parser.kind === "text" || allowBytesParsers)
                          )
                          .map((parser) => (
                            <SelectItem key={parser.id} value={parser.id}>
                              {parser.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="chartType">图表类型</Label>
                  <Select
                    value={localConfig.chartType}
                    onValueChange={(value: ChartType) => setLocalConfig({ ...localConfig, chartType: value })}
                  >
                    <SelectTrigger id="chartType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="waveform">波形示波器</SelectItem>
                      <SelectItem value="line">折线图</SelectItem>
                      <SelectItem value="bar">柱状图</SelectItem>
                      <SelectItem value="scatter">散点图（按时间）</SelectItem>
                      <SelectItem value="xy-scatter">XY 散点图</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {allowParserConfig && <p className="text-xs text-muted-foreground leading-5">{parseModeHint}</p>}

              {allowParserConfig && localConfig.parseMode === "binary" && (
                <BinaryProtocolDesigner
                  value={localConfig.binaryProtocol}
                  samples={samples}
                  onChange={(binaryProtocol) =>
                    setLocalConfig((current) => {
                      const next = { ...current, binaryProtocol };
                      return {
                        ...next,
                        channels: resolveAppliedParserChannels(current.channels, createBinaryProtocolChannels(next)),
                      };
                    })
                  }
                />
              )}

              {allowParserConfig && !isBytesParseMode(localConfig.parseMode) && (
                <div className="space-y-2">
                  <Label htmlFor="framePrefix">数据帧前缀（可选）</Label>
                  <Input
                    id="framePrefix"
                    value={localConfig.framePrefix}
                    placeholder="例如 P: 或 @PLOT:"
                    className="font-mono"
                    onChange={(event) => {
                      const framePrefix = event.target.value;
                      setLocalConfig({ ...localConfig, framePrefix });
                      const sample = [...samples]
                        .reverse()
                        .find(({ text }) => !framePrefix || text.startsWith(framePrefix));
                      if (sample) setSampleText(sample.text);
                    }}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    只解析以此前缀开头的文本；匹配后会剥离前缀，原始日志仍完整显示。
                  </p>
                </div>
              )}

              {isXyScatter && (
                <p className="text-xs text-muted-foreground leading-5">
                  XY 散点图需要一条通道把「角色」选成「X」，其余通道作为 Y 值。
                </p>
              )}
            </section>
          )}

          {/* 2. 模式专属字段 */}
          {allowParserConfig &&
            activeSection === "basic" &&
            (localConfig.parseMode === "delimiter" || localConfig.parseMode === "regex") && (
              <section className="rounded-[24px] border border-border/60 p-4 space-y-3">
                <div className="text-sm font-medium">
                  {localConfig.parseMode === "delimiter" ? "分隔符" : "正则表达式"}
                </div>

                {localConfig.parseMode === "delimiter" && (
                  <div className="space-y-2">
                    <Label htmlFor="delimiter">分隔符（字符或转义序列）</Label>
                    <Input
                      id="delimiter"
                      value={localConfig.delimiter}
                      placeholder=", / \t / ; / 空格"
                      onChange={(event) => setLocalConfig({ ...localConfig, delimiter: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      例如 <code className="font-mono">20,4997.32,122954.44</code> 用{" "}
                      <code className="font-mono">,</code>。
                    </p>
                  </div>
                )}

                {localConfig.parseMode === "regex" && (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                      <div className="space-y-2">
                        <Label htmlFor="regexPattern">正则表达式</Label>
                        <Input
                          id="regexPattern"
                          value={localConfig.regexPattern}
                          placeholder="temp:(?<temp>\d+\.\d+)"
                          className="font-mono"
                          onChange={(event) => setLocalConfig({ ...localConfig, regexPattern: event.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="regexFlags">标志</Label>
                        <Input
                          id="regexFlags"
                          value={localConfig.regexFlags || ""}
                          placeholder="g / gi"
                          onChange={(event) => setLocalConfig({ ...localConfig, regexFlags: event.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="regexSample">数据样本</Label>
                      <textarea
                        id="regexSample"
                        value={sampleText}
                        onChange={(event) => setSampleText(event.target.value)}
                        rows={3}
                        className="w-full resize-y rounded-[14px] border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                        placeholder="输入一条日志，立即检查命名捕获组能否提取数值"
                      />
                    </div>

                    <div
                      className={`rounded-[16px] border p-3 ${
                        regexPreview?.success
                          ? "border-green-500/25 bg-green-500/10"
                          : "border-amber-500/25 bg-amber-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {regexPreview?.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                        )}
                        {regexPreview?.message ?? "请输入一条数据样本"}
                      </div>
                      {regexPreview && Object.keys(regexPreview.values).length > 0 && (
                        <div className="mt-2 grid gap-1 font-mono text-xs text-muted-foreground sm:grid-cols-2">
                          {Object.entries(regexPreview.values).map(([key, value]) => (
                            <div key={key} className="flex justify-between gap-3">
                              <span>{key}</span>
                              <span>{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

          {/* 3. 通道表格 */}
          {activeSection === "channels" && (
            <section className="rounded-[24px] border border-border/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">通道</div>
                  <p className="text-xs text-muted-foreground">一行一个通道，统一管理「字段名 / 显示样式 / X 轴」。</p>
                </div>
                <div className="flex gap-2">
                  {localConfig.channels.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setLocalConfig({ ...localConfig, channels: [] })}>
                      重置通道
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={addChannel}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    添加
                  </Button>
                </div>
              </div>

              {channelHint && <p className="text-xs leading-5 text-muted-foreground">{channelHint}</p>}

              {localConfig.channels.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                  还没有通道。
                  {(localConfig.parseMode === "json" || localConfig.parseMode === "kv") &&
                    "（留空时会自动提取所有数值字段）"}
                  {localConfig.parseMode === "justfloat" && "（留空时会按首个有效帧自动生成通道）"}
                  {localConfig.parseMode === "binary" && "（通道由协议字段自动生成）"}
                  {isModbusParseMode(localConfig.parseMode) && "（留空时会按读取块自动生成通道）"}
                </div>
              ) : (
                <div className="space-y-2">
                  <ChannelHeaderRow
                    isDelimiter={isDelimiter}
                    sourceIndexLabel={sourceIndexLabel}
                    isXyScatter={isXyScatter}
                  />
                  {localConfig.channels.map((channel, index) => (
                    <ChannelRow
                      key={`${channel.key}-${index}`}
                      channel={channel}
                      index={index}
                      total={localConfig.channels.length}
                      isDelimiter={isDelimiter}
                      isXyScatter={isXyScatter}
                      onChange={(patch) => updateChannel(index, patch)}
                      onMove={(dir) => moveChannel(index, dir)}
                      onRemove={() => removeChannel(index)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {allowDataFilter && activeSection === "filter" && filterFields}

          {/* 4. 性能与采样 */}
          {activeSection === "performance" && (
            <section className="rounded-[24px] border border-border/60 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <NumberField
                  id="maxDataPoints"
                  label="最大数据点数"
                  value={localConfig.maxDataPoints}
                  min={MIN_CHART_DATA_POINTS}
                  max={MAX_CHART_DATA_POINTS}
                  onChange={(value) =>
                    setLocalConfig({
                      ...localConfig,
                      maxDataPoints: Math.min(Math.max(value, MIN_CHART_DATA_POINTS), MAX_CHART_DATA_POINTS),
                    })
                  }
                />
                <NumberField
                  id="visiblePointLimit"
                  label="可视点数 (0=自动)"
                  value={localConfig.visiblePointLimit}
                  onChange={(value) => setLocalConfig({ ...localConfig, visiblePointLimit: Math.max(value, 0) })}
                />
                <NumberField
                  id="updateInterval"
                  label="独立窗口刷新间隔 (ms)"
                  value={localConfig.updateInterval}
                  onChange={(value) => setLocalConfig({ ...localConfig, updateInterval: Math.max(value, 16) })}
                />
                <NumberField
                  id="sampleRateHz"
                  label="采样率 (Hz, 0=自动)"
                  value={localConfig.sampleRateHz}
                  onChange={(value) => setLocalConfig({ ...localConfig, sampleRateHz: Math.max(value, 0) })}
                />
                <NumberField
                  id="fftWindowSize"
                  label="FFT 窗口大小 (32-4096)"
                  value={localConfig.fftWindowSize}
                  onChange={(value) =>
                    setLocalConfig({
                      ...localConfig,
                      fftWindowSize: Math.min(Math.max(value, 32), 4096),
                    })
                  }
                />
              </div>
            </section>
          )}

          {/* 5. 显示选项 */}
          {activeSection === "display" && (
            <section className="rounded-[24px] border border-border/60 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                {localConfig.chartType === "waveform" && (
                  <div className="space-y-1.5 rounded-[18px] border border-border/60 px-3 py-2.5">
                    <Label>波形连接方式</Label>
                    <Select
                      value={localConfig.waveformInterpolation}
                      onValueChange={(waveformInterpolation: WaveformInterpolation) =>
                        setLocalConfig({ ...localConfig, waveformInterpolation })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="linear">直线连接</SelectItem>
                        <SelectItem value="smooth">平滑曲线</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <ToggleRow
                  label="显示网格"
                  checked={localConfig.showGrid}
                  onCheckedChange={(checked) => setLocalConfig({ ...localConfig, showGrid: checked })}
                />
                <ToggleRow
                  label="显示图例"
                  checked={localConfig.showLegend}
                  onCheckedChange={(checked) => setLocalConfig({ ...localConfig, showLegend: checked })}
                />
                <ToggleRow
                  label="显示 Tooltip"
                  checked={localConfig.showTooltip}
                  onCheckedChange={(checked) => setLocalConfig({ ...localConfig, showTooltip: checked })}
                />
                <ToggleRow
                  label="启用动画"
                  checked={localConfig.animationEnabled}
                  onCheckedChange={(checked) => setLocalConfig({ ...localConfig, animationEnabled: checked })}
                />
              </div>
            </section>
          )}
        </div>

        <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 mt-4 flex justify-end gap-2 border-t border-border/60 bg-background/90 px-5 py-4 backdrop-blur">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存配置</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelHeaderRow({
  isDelimiter,
  sourceIndexLabel,
  isXyScatter,
}: {
  isDelimiter: boolean;
  sourceIndexLabel: string;
  isXyScatter: boolean;
}) {
  return (
    <div
      className="grid items-center gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: gridTemplate(isDelimiter, isXyScatter) }}
    >
      <span>键</span>
      {isDelimiter && <span>{sourceIndexLabel}</span>}
      <span>显示名称</span>
      <span>单位</span>
      <span>颜色</span>
      {isXyScatter && <span>角色</span>}
      <span className="text-center">显示</span>
      <span />
    </div>
  );
}

function ChannelRow({
  channel,
  index,
  total,
  isDelimiter,
  isXyScatter,
  onChange,
  onMove,
  onRemove,
}: {
  channel: Channel;
  index: number;
  total: number;
  isDelimiter: boolean;
  isXyScatter: boolean;
  onChange: (patch: Partial<Channel>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid items-center gap-2 rounded-[18px] border border-border/60 bg-white/65 p-2"
      style={{ gridTemplateColumns: gridTemplate(isDelimiter, isXyScatter) }}
    >
      <Input
        value={channel.key}
        placeholder="key"
        onChange={(e) => onChange({ key: e.target.value })}
        className="h-9"
      />
      {isDelimiter && (
        <Input
          type="number"
          min={0}
          value={channel.sourceIndex ?? ""}
          placeholder="列号"
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === "" ? undefined : Math.max(parseInt(raw, 10) || 0, 0);
            onChange({ sourceIndex: parsed });
          }}
          className="h-9"
        />
      )}
      <Input
        value={channel.name}
        placeholder={channel.key}
        onChange={(e) => onChange({ name: e.target.value })}
        className="h-9"
      />
      <Input
        value={channel.unit ?? ""}
        placeholder="℃ / Hz"
        onChange={(e) => onChange({ unit: e.target.value || undefined })}
        className="h-9"
      />
      <input
        type="color"
        value={channel.color}
        onChange={(e) => onChange({ color: e.target.value })}
        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
        aria-label="颜色"
      />
      {isXyScatter && (
        <Select value={channel.role ?? "y"} onValueChange={(value) => onChange({ role: value as "x" | "y" })}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="y">Y</SelectItem>
            <SelectItem value="x">X</SelectItem>
          </SelectContent>
        </Select>
      )}
      <div className="flex justify-center">
        <Switch checked={channel.visible} onCheckedChange={(checked) => onChange({ visible: checked })} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="上移"
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label="下移"
        >
          ↓
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onRemove} aria-label="删除">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function gridTemplate(isDelimiter: boolean, isXyScatter: boolean) {
  // [key] [sourceIndex?] [name] [unit] [color] [role?] [visible] [actions]
  const cols = ["minmax(0, 1.2fr)"];
  if (isDelimiter) cols.push("80px");
  cols.push("minmax(0, 1.4fr)");
  cols.push("80px");
  cols.push("56px");
  if (isXyScatter) cols.push("80px");
  cols.push("64px");
  cols.push("auto");
  return cols.join(" ");
}

function FrequencyResponsePreview({
  stages,
  selectedStage,
  sampleRateHz,
}: {
  stages: ParametricFilterStage[];
  selectedStage?: ParametricFilterStage;
  sampleRateHz: number;
}) {
  const overallSos = designParametricSos(stages, sampleRateHz);
  const selectedSos = selectedStage ? designParametricSos([{ ...selectedStage, enabled: true }], sampleRateHz) : null;
  const overall = overallSos ? calculateSosFrequencyResponse(overallSos, sampleRateHz) : [];
  const selected = selectedSos ? calculateSosFrequencyResponse(selectedSos, sampleRateHz) : [];

  if (overall.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
        填写有效的采样率和滤波级参数后显示频率响应。
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const left = 48;
  const right = 16;
  const top = 14;
  const bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const responsePath = (response: typeof overall) =>
    response
      .map((point, index) => {
        const x = left + (index / (response.length - 1)) * plotWidth;
        const y = top + ((12 - point.magnitudeDb) / 92) * plotHeight;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const minFrequency = overall[0].frequencyHz;
  const maxFrequency = overall[overall.length - 1]?.frequencyHz ?? sampleRateHz / 2;
  const markerX =
    selectedStage && selectedStage.frequencyHz > 0 && selectedStage.frequencyHz < maxFrequency
      ? left + (Math.log(selectedStage.frequencyHz / minFrequency) / Math.log(maxFrequency / minFrequency)) * plotWidth
      : null;

  return (
    <div className="rounded-[18px] border border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">频率响应</div>
          <p className="text-xs text-muted-foreground">实线为综合响应，虚线为当前选中级；横轴为对数频率。</p>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>— 综合</span>
          <span className="text-amber-500">┄ 当前级</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full text-muted-foreground"
        role="img"
        aria-label="滤波器幅频响应图"
      >
        {[-80, -60, -40, -20, 0].map((db) => {
          const y = top + ((12 - db) / 92) * plotHeight;
          return (
            <g key={db}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="currentColor" opacity="0.16" />
              <text x={left - 7} y={y + 4} textAnchor="end" fill="currentColor" fontSize="10">
                {db} dB
              </text>
            </g>
          );
        })}
        {[0, Math.floor((overall.length - 1) / 2), overall.length - 1].map((index) => {
          const x = left + (index / (overall.length - 1)) * plotWidth;
          return (
            <g key={index}>
              <line x1={x} y1={top} x2={x} y2={height - bottom} stroke="currentColor" opacity="0.12" />
              <text x={x} y={height - 9} textAnchor="middle" fill="currentColor" fontSize="10">
                {formatFrequency(overall[index].frequencyHz)}
              </text>
            </g>
          );
        })}
        {markerX !== null && (
          <line
            x1={markerX}
            y1={top}
            x2={markerX}
            y2={height - bottom}
            stroke="#f59e0b"
            strokeDasharray="2 4"
            opacity="0.55"
          />
        )}
        <path d={responsePath(overall)} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" />
        {selected.length > 0 && (
          <path d={responsePath(selected)} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="6 4" />
        )}
      </svg>
    </div>
  );
}

function parametricTypeLabel(type: ParametricFilterType): string {
  if (type === "highpass") return "高通";
  if (type === "bandpass") return "带通";
  return "低通";
}

function formatFrequency(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Number(value.toPrecision(3))} Hz`;
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = "any",
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number | "any";
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
      />
    </div>
  );
}

function MatlabTextField({
  id,
  label,
  value,
  placeholder,
  rows = 4,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-[18px] border border-border/60 px-3 py-2">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
