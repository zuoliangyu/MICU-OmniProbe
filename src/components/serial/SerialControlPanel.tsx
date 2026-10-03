import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  Activity,
  AudioWaveform,
  Box,
  ChevronsUpDown,
  CircleDot,
  CircleHelp,
  Gamepad2,
  Gauge,
  Hash,
  ListOrdered,
  MousePointerClick,
  ScrollText,
  SlidersHorizontal,
  Spline,
  TextCursorInput,
  ToggleRight,
  Download,
  ExternalLink,
  GripHorizontal,
  GripVertical,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Play,
  Settings2,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLogStore } from "@/stores/logStore";
import { useSerialStore } from "@/stores/serialStore";
import { useShallow } from "zustand/react/shallow";
import { sendSerialPayload } from "@/lib/serialSend";
import {
  createSerialControlWidget,
  clampFloatingPanelPosition,
  getSerialControlWidgetInputHelp,
  getSerialControlWidgetTypeLabel,
  loadSerialControlPanel,
  parseSerialCommandSequence,
  parseSerialControlPanel,
  saveSerialControlPanel,
  SERIAL_CONTROL_WIDGET_GROUPS,
  type SerialControlPanelConfig,
  type SerialControlWidget,
  type SerialControlWidgetType,
} from "@/lib/serialControlPanel";
import { cn } from "@/lib/utils";
import { exportJson } from "@/lib/exporters";
import type { SerialViewerData } from "./SerialViewer";
import type { ChartConfig, ChartDataPoint } from "@/lib/chartTypes";
import type { ControlPanelSource } from "@/stores/controlPanelStore";
import {
  isSerialSendWidget,
  SerialSendWidgetControl,
  SerialSendWidgetEditor,
  type SerialSendRuntimeValue,
} from "./SerialSendControlWidgets";
import {
  isSerialDisplayWidget,
  SerialDisplayWidgetControl,
  SerialDisplayWidgetEditor,
} from "./SerialDisplayControlWidgets";
import {
  isSerialVisualizationWidget,
  SerialVisualizationWidgetControl,
  SerialVisualizationWidgetEditor,
} from "./SerialVisualizationControlWidgets";

type RuntimeValue = SerialSendRuntimeValue;
const EMPTY_CHART_VALUES: Record<string, number> = {};
const CANVAS_GAP = 12;
const MIN_WIDGET_WIDTH = 200;
const MIN_WIDGET_HEIGHT = 96;
const WIDGET_INPUT_DOC_URL = "https://zuoliangyu.github.io/MICU-OmniProbe/#/SERIAL_CONTROL_PANEL_GUIDE";

export interface ControlPanelData extends SerialViewerData {
  chartData: ChartDataPoint[];
  processedChartData: ChartDataPoint[];
  filterActive: boolean;
  chartConfig: ChartConfig;
  sendSettings: {
    encoding: string;
    lineEnding: string;
    hexMode: boolean;
  };
}

interface SerialControlPanelProps {
  sendPayload?: (text: string, options?: { hexMode?: boolean }) => Promise<void>;
  showWorkspaceActions?: boolean;
  source?: ControlPanelSource;
  onSourceChange?: (source: ControlPanelSource) => void;
  data?: ControlPanelData;
  canSend?: boolean;
  onOpenChart?: () => void;
  sourceDescription?: string;
  onOpenSourceSettings?: () => void;
}

function initialRuntimeValues(panel: SerialControlPanelConfig) {
  return Object.fromEntries(
    panel.widgets.flatMap<[string, RuntimeValue]>((widget) =>
      widget.type === "joystick"
        ? [[widget.id, { x: widget.x, y: widget.y }]]
        : "value" in widget
          ? [[widget.id, widget.value]]
          : []
    )
  ) as Record<string, RuntimeValue>;
}

/** 组件库里每种组件的识别图标，避免全部是同一个「+」难以扫读 */
const WIDGET_PALETTE_ICONS: Record<SerialControlWidgetType, LucideIcon> = {
  button: MousePointerClick,
  toggle: ToggleRight,
  slider: SlidersHorizontal,
  input: TextCursorInput,
  stepper: ChevronsUpDown,
  joystick: Gamepad2,
  sequence: ListOrdered,
  value: Hash,
  indicator: CircleDot,
  gauge: Gauge,
  "serial-log": ScrollText,
  "yt-chart": Activity,
  "fft-chart": AudioWaveform,
  "xy-chart": Spline,
  "imu-3d": Box,
};

export function SerialControlPanel({
  sendPayload = sendSerialPayload,
  showWorkspaceActions = true,
  source = "serial",
  onSourceChange,
  data,
  canSend = true,
  onOpenChart,
  sourceDescription,
  onOpenSourceSettings,
}: SerialControlPanelProps = {}) {
  // 外部传入 data（RTT 来源）时不订阅串口 store，否则编辑器会被两条数据流一起带着重渲染
  const serialData = useSerialStore(
    useShallow((state) =>
      data
        ? null
        : {
            connected: state.connected,
            running: state.running,
            lines: state.lines,
            autoScroll: state.autoScroll,
            showTimestamp: state.showTimestamp,
            timestampFormat: state.timestampFormat,
            showDirectionPrefix: state.showDirectionPrefix,
            displayMode: state.displayMode,
            searchQuery: state.searchQuery,
            sendSettings: state.sendSettings,
            chartData: state.chartData,
            processedChartData: state.processedChartData,
            filterActive: state.filterActive,
            chartConfig: state.chartConfig,
          }
    )
  );
  const setSerialViewMode = useSerialStore((state) => state.setViewMode);
  const sourceData = (data ?? serialData)!;
  const {
    connected,
    sendSettings,
    chartData: rawChartData,
    processedChartData,
    filterActive,
    chartConfig,
  } = sourceData;
  const displayData = useMemo(
    () => ({ ...sourceData, chartData: processedChartData }),
    [processedChartData, sourceData]
  );
  const latestValues = processedChartData[processedChartData.length - 1]?.values ?? EMPTY_CHART_VALUES;
  const chartChannels = chartConfig.channels;
  const sendEnabled = connected && canSend;
  const addLog = useLogStore((state) => state.addLog);
  const [panel, setPanel] = useState(loadSerialControlPanel);
  const [editing, setEditing] = useState(panel.widgets.length === 0);
  const [paletteOpen, setPaletteOpen] = useState(() => !window.matchMedia("(max-width: 1100px)").matches);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(panel.widgets[0]?.id ?? null);
  const [runtimeValues, setRuntimeValues] = useState(() => initialRuntimeValues(panel));
  const [draggedType, setDraggedType] = useState<SerialControlWidgetType | null>(null);
  const [gesture, setGesture] = useState<{ id: string; mode: "move" | "resize" } | null>(null);
  const [status, setStatus] = useState("等待操作");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // 默认停靠在画布右侧，不遮挡画布；需要更大画布时可切换为可拖动的浮动面板
  const [inspectorFloating, setInspectorFloating] = useState(false);
  const [inspectorPosition, setInspectorPosition] = useState({ x: 0, y: 0 });
  const [runningSequenceId, setRunningSequenceId] = useState<string | null>(null);
  const runningSequenceRef = useRef<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorDragRef = useRef<{
    startX: number;
    startY: number;
    position: { x: number; y: number };
  } | null>(null);
  const gestureStartRef = useRef<{
    id: string;
    x: number;
    y: number;
    widgetLeft: number;
    widgetTop: number;
    width: number;
    height: number;
    mode: "move" | "resize";
  } | null>(null);
  const availableChannels = Array.from(
    new Set([...chartChannels.map((channel) => channel.key), ...Object.keys(latestValues)])
  );

  useEffect(() => saveSerialControlPanel(panel), [panel]);

  useEffect(() => {
    const compactLayout = window.matchMedia("(max-width: 1100px)");
    const collapsePalette = (event: MediaQueryListEvent) => {
      if (event.matches) setPaletteOpen(false);
    };

    compactLayout.addEventListener("change", collapsePalette);
    return () => compactLayout.removeEventListener("change", collapsePalette);
  }, []);

  useEffect(() => {
    if (editing) setInspectorOpen(true);
  }, [editing]);

  useEffect(() => {
    const keepInspectorInBounds = () => {
      const workspace = workspaceRef.current;
      const inspector = inspectorRef.current;
      if (!workspace || !inspector) return;
      setInspectorPosition((position) =>
        clampFloatingPanelPosition(
          position,
          { width: workspace.clientWidth, height: workspace.clientHeight },
          { width: inspector.offsetWidth, height: inspector.offsetHeight }
        )
      );
    };
    window.addEventListener("resize", keepInspectorInBounds);
    return () => window.removeEventListener("resize", keepInspectorInBounds);
  }, []);

  const moveInspector = (position: { x: number; y: number }) => {
    const workspace = workspaceRef.current;
    const inspector = inspectorRef.current;
    if (!workspace || !inspector) return;
    setInspectorPosition(
      clampFloatingPanelPosition(
        position,
        { width: workspace.clientWidth, height: workspace.clientHeight },
        { width: inspector.offsetWidth, height: inspector.offsetHeight }
      )
    );
  };

  const startInspectorDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    inspectorDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      position: inspectorPosition,
    };
  };

  const dragInspector = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = inspectorDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    moveInspector({
      x: drag.position.x + event.clientX - drag.startX,
      y: drag.position.y + event.clientY - drag.startY,
    });
  };

  const finishInspectorDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    inspectorDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const moveInspectorWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const movement = {
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
      ArrowDown: { x: 0, y: 16 },
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    moveInspector({ x: inspectorPosition.x + movement.x, y: inspectorPosition.y + movement.y });
  };

  const updateWidget = (id: string, updater: (widget: SerialControlWidget) => SerialControlWidget) => {
    setPanel((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? updater(widget) : widget)),
    }));
  };

  const addWidget = (type: SerialControlWidgetType, position?: { x: number; y: number }) => {
    const created = createSerialControlWidget(type);
    const widget = {
      ...created,
      left: Math.max(0, position?.x ?? 0),
      top:
        position?.y ?? panel.widgets.reduce((bottom, item) => Math.max(bottom, item.top + item.height + CANVAS_GAP), 0),
    };
    setPanel((current) => ({ ...current, widgets: [...current.widgets, widget] }));
    if ("value" in widget) setRuntimeValues((current) => ({ ...current, [widget.id]: widget.value }));
    setSelectedWidgetId(widget.id);
  };

  const removeWidget = (id: string) => {
    setPanel((current) => ({ ...current, widgets: current.widgets.filter((widget) => widget.id !== id) }));
    setSelectedWidgetId((current) => (current === id ? null : current));
  };

  const startGesture = (
    widget: SerialControlWidget,
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!editing || !canvasRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureStartRef.current = {
      id: widget.id,
      x: event.clientX,
      y: event.clientY,
      widgetLeft: widget.left,
      widgetTop: widget.top,
      width: widget.width,
      height: widget.height,
      mode,
    };
    setGesture({ id: widget.id, mode });
    setSelectedWidgetId(widget.id);
  };

  const moveGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = gestureStartRef.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    updateWidget(start.id, (current) =>
      start.mode === "move"
        ? { ...current, left: Math.max(0, start.widgetLeft + dx), top: Math.max(0, start.widgetTop + dy) }
        : {
            ...current,
            width: Math.min(2_400, Math.max(MIN_WIDGET_WIDTH, start.width + dx)),
            height: Math.min(2_000, Math.max(MIN_WIDGET_HEIGHT, start.height + dy)),
          }
    );
  };

  const finishGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const movedId = gestureStartRef.current?.id;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (movedId) {
      setPanel((current) => ({
        ...current,
        widgets: [
          ...current.widgets.filter((item) => item.id !== movedId),
          ...current.widgets.filter((item) => item.id === movedId),
        ],
      }));
    }
    gestureStartRef.current = null;
    setGesture(null);
  };

  const sendCommand = async (widget: SerialControlWidget, command: string) => {
    if (!command.trim()) {
      addLog("warn", `${widget.label} 的发送内容为空`);
      return false;
    }
    try {
      await sendPayload(command, { hexMode: widget.format === "hex" });
      setStatus(`${widget.label} 已发送`);
      return true;
    } catch (error) {
      addLog("error", `${widget.label} 发送失败: ${error}`);
      setStatus(`${widget.label} 发送失败`);
      return false;
    }
  };

  const runSequence = async (widget: Extract<SerialControlWidget, { type: "sequence" }>) => {
    if (runningSequenceRef.current) return;
    const commands = parseSerialCommandSequence(widget.commands);
    if (commands.length === 0) {
      addLog("warn", `${widget.label} 没有可发送的命令`);
      return;
    }
    runningSequenceRef.current = widget.id;
    setRunningSequenceId(widget.id);
    try {
      for (let index = 0; index < commands.length; index += 1) {
        setStatus(`${widget.label} ${index + 1}/${commands.length}`);
        if (!(await sendCommand(widget, commands[index]))) return;
        if (index < commands.length - 1 && widget.intervalMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, widget.intervalMs));
        }
      }
      setStatus(`${widget.label} 已完成`);
    } finally {
      runningSequenceRef.current = null;
      setRunningSequenceId(null);
    }
  };

  const exportPanel = async () => {
    try {
      const fileName = `${panel.name.replace(/[\\/:*?"<>|]+/g, "-") || "serial-control-panel"}.json`;
      const path = await exportJson(JSON.stringify(parseSerialControlPanel(panel), null, 2), fileName);
      if (path) setStatus(`已导出到 ${path}`);
    } catch (error) {
      addLog("error", `控制面板导出失败: ${error}`);
    }
  };

  const importPanel = async (file: File) => {
    try {
      const nextPanel = parseSerialControlPanel(JSON.parse(await file.text()));
      setPanel(nextPanel);
      setRuntimeValues(initialRuntimeValues(nextPanel));
      setEditing(true);
      setSelectedWidgetId(nextPanel.widgets[0]?.id ?? null);
      setStatus(`已导入 ${nextPanel.name}`);
    } catch (error) {
      addLog("error", `控制面板导入失败: ${error}`);
    }
  };

  const toggleEditing = () => {
    if (!editing) {
      setEditing(true);
      setSelectedWidgetId(panel.widgets[0]?.id ?? null);
      return;
    }
    const normalized = parseSerialControlPanel(panel);
    setPanel(normalized);
    setRuntimeValues(initialRuntimeValues(normalized));
    setEditing(false);
    setSelectedWidgetId(null);
  };

  const renderEditor = (widget: SerialControlWidget) => (
    <div className="space-y-3">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${widget.id}-label`}>名称</Label>
          <Input
            id={`${widget.id}-label`}
            value={widget.label}
            onChange={(event) => updateWidget(widget.id, (current) => ({ ...current, label: event.target.value }))}
          />
        </div>
      </div>

      {isSerialSendWidget(widget) && (
        <SerialSendWidgetEditor widget={widget} onChange={(next) => updateWidget(widget.id, () => next)} />
      )}

      {isSerialDisplayWidget(widget) && (
        <SerialDisplayWidgetEditor widget={widget} onChange={(next) => updateWidget(widget.id, () => next)} />
      )}

      {isSerialVisualizationWidget(widget) && (
        <SerialVisualizationWidgetEditor widget={widget} onChange={(next) => updateWidget(widget.id, () => next)} />
      )}
    </div>
  );

  const renderControl = (widget: SerialControlWidget) => {
    if (isSerialSendWidget(widget)) {
      return (
        <SerialSendWidgetControl
          widget={widget}
          sendEnabled={sendEnabled}
          runtimeValue={runtimeValues[widget.id]}
          runningSequenceId={runningSequenceId}
          onRuntimeValueChange={(value) => setRuntimeValues((current) => ({ ...current, [widget.id]: value }))}
          onUpdateWidget={(updater) =>
            updateWidget(widget.id, (current) => (isSerialSendWidget(current) ? updater(current) : current))
          }
          onSend={sendCommand}
          onRunSequence={runSequence}
        />
      );
    }

    if (isSerialDisplayWidget(widget)) {
      return <SerialDisplayWidgetControl widget={widget} latestValues={latestValues} data={displayData} />;
    }

    if (isSerialVisualizationWidget(widget)) {
      return (
        <SerialVisualizationWidgetControl
          widget={widget}
          showWorkspaceActions={showWorkspaceActions}
          source={source}
          chartData={processedChartData}
          rawChartData={filterActive && chartConfig.dataFilter.showOriginal ? rawChartData : undefined}
          filterActive={filterActive}
          chartConfig={chartConfig}
          latestValues={latestValues}
          onOpenChart={onOpenChart ?? (() => setSerialViewMode("chart"))}
          onUpdateImu={(patch) =>
            updateWidget(widget.id, (current) => (current.type === "imu-3d" ? { ...current, ...patch } : current))
          }
        />
      );
    }

    return null;
  };

  const selectedWidget = panel.widgets.find((widget) => widget.id === selectedWidgetId);
  const widgetInputHelp = selectedWidget ? getSerialControlWidgetInputHelp(selectedWidget) : undefined;
  const canvasWidth = Math.max(900, ...panel.widgets.map((widget) => widget.left + widget.width + CANVAS_GAP));
  const canvasHeight = Math.max(560, ...panel.widgets.map((widget) => widget.top + widget.height + CANVAS_GAP));
  const inspectorContent =
    editing && selectedWidget ? (
      <div className="space-y-4">
        <div className="flex items-start gap-2 border-b border-border/60 pb-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{selectedWidget.label}</div>
            <div className="text-xs text-muted-foreground">{selectedWidget.type}</div>
          </div>
          {widgetInputHelp && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" title="查看组件输入格式">
                  <CircleHelp className="h-4 w-4" />
                  <span className="sr-only">查看组件输入格式</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent side="left" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3">
                <div>
                  <div className="text-sm font-semibold">{selectedWidget.label} · 格式参考</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{widgetInputHelp.description}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{widgetInputHelp.sampleLabel}</div>
                  <code className="block overflow-x-auto rounded-lg bg-muted px-2 py-2 font-mono text-[11px]">
                    {widgetInputHelp.example}
                  </code>
                </div>
                <div className="rounded-lg border border-border/60 px-2 py-2 text-xs">{widgetInputHelp.flow}</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() =>
                    void open(`${WIDGET_INPUT_DOC_URL}?id=${widgetInputHelp.docId}`).catch((error) =>
                      console.error("打开组件输入文档失败:", error)
                    )
                  }
                >
                  查看完整文档
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </PopoverContent>
            </Popover>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-red-500"
            onClick={() => removeWidget(selectedWidget.id)}
            title="删除组件"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["left", "X", 0],
              ["top", "Y", 0],
              ["width", "宽度", MIN_WIDGET_WIDTH],
              ["height", "高度", MIN_WIDGET_HEIGHT],
            ] as const
          ).map(([key, label, min]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`${selectedWidget.id}-${key}`}>{label}</Label>
              <Input
                id={`${selectedWidget.id}-${key}`}
                type="number"
                min={min}
                value={Math.round(selectedWidget[key])}
                onChange={(event) =>
                  updateWidget(selectedWidget.id, (current) => ({
                    ...current,
                    [key]: Math.max(min, Number(event.target.value) || min),
                  }))
                }
              />
            </div>
          ))}
        </div>
        {renderEditor(selectedWidget)}
      </div>
    ) : null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/10">
      <datalist id="serial-control-channels">
        {availableChannels.map((channel) => (
          <option key={channel} value={channel} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-white/70 px-3 py-2">
        <LayoutDashboard className="h-4 w-4 text-primary" />
        {editing ? (
          <Input
            value={panel.name}
            onChange={(event) => setPanel((current) => ({ ...current, name: event.target.value }))}
            className="h-8 w-48"
            aria-label="控制面板名称"
          />
        ) : (
          <span className="text-sm font-medium text-foreground">{panel.name}</span>
        )}
        <Select
          value={source}
          disabled={!onSourceChange}
          onValueChange={(value) => onSourceChange?.(value as ControlPanelSource)}
        >
          <SelectTrigger className="h-8 w-40" aria-label="控制面板数据来源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="serial">串口</SelectItem>
            <SelectItem value="rtt">RTT</SelectItem>
            <SelectItem value="bluetooth" disabled>
              BLE（暂未实现）
            </SelectItem>
          </SelectContent>
        </Select>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            connected ? "bg-emerald-500/12 text-emerald-700" : "bg-red-500/12 text-red-600"
          )}
        >
          {source === "rtt" ? "RTT" : "串口"}
          {connected ? "已连接" : "未连接"}
        </span>
        <span className="text-xs text-muted-foreground">
          {status} ·{" "}
          {canSend
            ? `发送 ${sendSettings.encoding.toUpperCase()} / ${sendSettings.lineEnding.toUpperCase()}`
            : "只读数据源"}
        </span>
        {sourceDescription && (
          <span className="max-w-64 truncate text-xs text-muted-foreground" title={sourceDescription}>
            {sourceDescription}
          </span>
        )}
        {onOpenSourceSettings && (
          <Button size="sm" variant="ghost" className="gap-1" onClick={onOpenSourceSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            前往设置
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPanel(file);
              event.target.value = "";
            }}
          />
          {editing && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setPaletteOpen((open) => !open)}
                title={paletteOpen ? "收起组件库" : "展开组件库"}
                aria-label={paletteOpen ? "收起组件库" : "展开组件库"}
              >
                {paletteOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
                组件库
              </Button>
              <Button
                size="sm"
                variant={inspectorOpen ? "secondary" : "outline"}
                className="gap-1"
                onClick={() => setInspectorOpen((open) => !open)}
              >
                {inspectorOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                组件属性
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            导入
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => void exportPanel()}>
            <Download className="h-3.5 w-3.5" />
            导出
          </Button>
          <Button size="sm" variant={editing ? "default" : "outline"} className="gap-1" onClick={toggleEditing}>
            {editing ? <Play className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? "运行" : "编辑"}
          </Button>
        </div>
      </div>

      <div ref={workspaceRef} className="relative flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
        {editing && paletteOpen && (
          <aside className="w-52 shrink-0 overflow-y-auto rounded-[18px] border border-border/60 bg-white/75 p-3">
            <div className="text-sm font-medium">组件库</div>
            <div className="mt-1 text-xs text-muted-foreground">拖入画布，或点击直接添加。</div>
            <div className="mt-4 space-y-4">
              {SERIAL_CONTROL_WIDGET_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map(({ type, label }) => {
                      const PaletteIcon = WIDGET_PALETTE_ICONS[type];
                      return (
                        <button
                          key={type}
                          type="button"
                          draggable
                          onDragStart={() => {
                            setDraggedType(type);
                          }}
                          onDragEnd={() => setDraggedType(null)}
                          onClick={() => addWidget(type)}
                          className="flex min-h-16 cursor-grab flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/30 px-2 text-center text-xs hover:border-primary/60 hover:bg-primary/5 active:cursor-grabbing"
                        >
                          <PaletteIcon className="mb-1.5 h-4 w-4 text-primary" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        <main
          className={cn(
            "min-h-0 flex-1 overflow-auto rounded-[18px] border bg-white/45 p-3",
            editing ? "border-dashed border-primary/45" : "border-border/60"
          )}
        >
          {editing && (
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <GripVertical className="h-4 w-4" />
              自由画布 · 拖动组件标题移动，拖动右下角连续调整大小
            </div>
          )}
          <section
            ref={canvasRef}
            className="relative min-h-full min-w-full"
            style={{ width: canvasWidth, height: canvasHeight }}
            onDragOver={(event) => editing && event.preventDefault()}
            onDrop={(event) => {
              if (!editing || !draggedType) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              addWidget(draggedType, { x: event.clientX - rect.left, y: event.clientY - rect.top });
              setDraggedType(null);
            }}
          >
            {panel.widgets.length === 0 ? (
              <div className="flex h-full min-h-64 items-center justify-center rounded-[20px] border border-dashed border-border/70 p-8 text-center">
                <div>
                  <LayoutDashboard className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="mt-3 text-sm font-medium">空白画布</div>
                  <div className="mt-1 text-xs text-muted-foreground">把左侧组件拖到这里开始搭建。</div>
                </div>
              </div>
            ) : (
              <>
                {panel.widgets.map((widget) => (
                  <div
                    key={widget.id}
                    onClick={() => {
                      if (!editing) return;
                      setSelectedWidgetId(widget.id);
                    }}
                    className={cn(
                      "absolute overflow-hidden rounded-[18px] border bg-white/90 p-3 shadow-[0_8px_18px_rgba(73,93,142,0.06)]",
                      editing && "border-dashed hover:border-primary/70",
                      editing && selectedWidgetId === widget.id && "border-primary ring-2 ring-primary/15",
                      gesture?.id === widget.id && "select-none"
                    )}
                    style={{
                      left: widget.left,
                      top: widget.top,
                      width: widget.width,
                      height: widget.height,
                      zIndex: selectedWidgetId === widget.id ? 2 : 1,
                    }}
                  >
                    {editing ? (
                      <>
                        <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
                          <button
                            type="button"
                            className="touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
                            onPointerDown={(event) => startGesture(widget, "move", event)}
                            onPointerMove={moveGesture}
                            onPointerUp={finishGesture}
                            onPointerCancel={finishGesture}
                            aria-label={`移动 ${widget.label}`}
                            title="拖动移动组件"
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <span className="text-xs font-medium text-muted-foreground">
                            {getSerialControlWidgetTypeLabel(widget.type)}
                          </span>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                            {widget.type === "serial-log"
                              ? widget.direction.toUpperCase()
                              : widget.type === "gauge" ||
                                  widget.type === "value" ||
                                  widget.type === "indicator" ||
                                  widget.type === "fft-chart" ||
                                  widget.type === "xy-chart" ||
                                  widget.type === "yt-chart" ||
                                  widget.type === "imu-3d"
                                ? "接收"
                                : widget.format === "hex"
                                  ? "HEX"
                                  : "文本"}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-red-500"
                              onClick={() => removeWidget(widget.id)}
                              title="删除控件"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="pointer-events-none h-[calc(100%_-_40px)] select-none overflow-hidden opacity-80">
                          {renderControl(widget)}
                        </div>
                      </>
                    ) : (
                      renderControl(widget)
                    )}
                    {editing && (
                      <button
                        type="button"
                        draggable={false}
                        className="absolute bottom-0 right-0 h-7 w-7 touch-none cursor-se-resize rounded-tl-xl border-l border-t border-primary/40 bg-primary/10 text-primary"
                        onPointerDown={(event) => startGesture(widget, "resize", event)}
                        onPointerMove={moveGesture}
                        onPointerUp={finishGesture}
                        onPointerCancel={finishGesture}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`调整 ${widget.label} 大小`}
                        title="拖动调整大小"
                      >
                        <span className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
        </main>
        {editing && (inspectorFloating || inspectorOpen) && (
          <aside
            ref={inspectorRef}
            className={cn(
              "w-80 overflow-y-auto rounded-[20px] border border-border/70 bg-white p-4 pb-6",
              inspectorFloating
                ? "absolute right-3 top-3 z-20 max-w-[calc(100%-1.5rem)] shadow-[0_18px_50px_rgba(42,57,91,0.2)] transition-opacity duration-200"
                : "min-h-0 shrink-0",
              inspectorFloating && !inspectorOpen && "pointer-events-none opacity-0"
            )}
            style={
              inspectorFloating
                ? {
                    maxHeight: "min(760px, calc(100% - 1.5rem))",
                    transform: `translate3d(${inspectorPosition.x}px, ${inspectorPosition.y}px, 0)`,
                  }
                : undefined
            }
          >
            <div className="sticky top-0 z-10 -mx-2 -mt-2 mb-4 flex w-[calc(100%+1rem)] items-center gap-1 rounded-xl bg-white p-1">
              {inspectorFloating ? (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 touch-none cursor-grab items-center gap-2 rounded-lg px-1 py-1 text-left text-sm font-medium active:cursor-grabbing"
                  onPointerDown={startInspectorDrag}
                  onPointerMove={dragInspector}
                  onPointerUp={finishInspectorDrag}
                  onPointerCancel={finishInspectorDrag}
                  onKeyDown={moveInspectorWithKeyboard}
                  aria-label="拖动组件属性面板，可使用方向键微调位置"
                >
                  <GripHorizontal className="h-4 w-4 text-muted-foreground" />
                  组件属性
                  <span className="ml-auto text-xs font-normal text-muted-foreground">拖动</span>
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-1 py-1 text-sm font-medium">组件属性</div>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  setInspectorPosition({ x: 0, y: 0 });
                  setInspectorFloating((floating) => !floating);
                }}
                title={inspectorFloating ? "停靠到右侧" : "改为浮动面板"}
                aria-label={inspectorFloating ? "停靠到右侧" : "改为浮动面板"}
              >
                {inspectorFloating ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() => setInspectorOpen(false)}
                title="收起组件属性"
                aria-label="收起组件属性"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </div>
            {inspectorContent ?? <div className="text-xs text-muted-foreground">请点击画布中的组件进行配置。</div>}
          </aside>
        )}
      </div>
    </div>
  );
}
