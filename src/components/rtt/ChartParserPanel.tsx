import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { AlertCircle, CheckCircle2, ChevronLeft, CircleHelp, ExternalLink, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  isBytesParseMode,
  isModbusParseMode,
  migrateChartConfig,
  type ChartConfig,
  type Channel,
  type ModbusDataType,
  type ParseMode,
} from "@/lib/chartTypes";
import type { DataSourceType } from "@/lib/serialTypes";
import { isModbusSourceCompatible } from "@/lib/parseModbusRtu";
import {
  haveChannelKeysChanged,
  previewChartParser,
  resolveAppliedParserChannels,
  type ChartSample,
} from "@/lib/chartAnalysis";
import { listChartParsers } from "@/lib/parseChartData";
import { ChartConfigDialog } from "@/components/rtt/ChartConfigDialog";
import { CanSignalEditor } from "@/components/serial/CanSignalEditor";
import { BinaryProtocolDesigner } from "@/components/serial/BinaryProtocolDesigner";
import { loadBinaryProtocolLibrary } from "@/lib/binaryProtocolLibrary";

const DATA_FORMAT_DOC_URL = "https://zuoliangyu.github.io/MICU-OmniProbe/#/DATA_FORMAT_GUIDE";

interface ChartParserPanelProps {
  chartConfig: ChartConfig;
  samples: ChartSample[];
  /** 数据源能否提供原始字节流。为 false 时隐藏字节流解析器——文本行已过分帧解码，还原不回字节。 */
  allowBytesParsers?: boolean;
  allowDataFilter?: boolean;
  dataSourceType?: DataSourceType;
  setChartConfig: (config: ChartConfig) => void;
  clearChartData?: () => void;
  onClose: () => void;
}

export function ChartParserPanel({
  chartConfig,
  samples,
  allowBytesParsers = false,
  allowDataFilter = false,
  dataSourceType = "local",
  setChartConfig,
  clearChartData,
  onClose,
}: ChartParserPanelProps) {
  const [parseMode, setParseMode] = useState(chartConfig.parseMode);
  const [framePrefix, setFramePrefix] = useState(chartConfig.framePrefix);
  const [delimiter, setDelimiter] = useState(chartConfig.delimiter);
  const [regexPattern, setRegexPattern] = useState(chartConfig.regexPattern);
  const [regexFlags, setRegexFlags] = useState(chartConfig.regexFlags ?? "");
  const [modbusRtu, setModbusRtu] = useState(chartConfig.modbusRtu);
  const [canBus, setCanBus] = useState(chartConfig.canBus);
  const [binaryProtocol, setBinaryProtocol] = useState(chartConfig.binaryProtocol);
  const [savedBinaryProtocols, setSavedBinaryProtocols] = useState(loadBinaryProtocolLibrary);
  const [canChannels, setCanChannels] = useState<Channel[]>(
    chartConfig.parseMode === "slcan" ? chartConfig.channels : []
  );
  const modbusMode = isModbusParseMode(parseMode);
  const incompatibleSource = modbusMode && !isModbusSourceCompatible(parseMode, dataSourceType);
  const latestSample = samples[samples.length - 1];
  const initialSample = chartConfig.framePrefix
    ? [...samples].reverse().find((sample) => sample.text.startsWith(chartConfig.framePrefix))
    : latestSample;
  const [sampleText, setSampleText] = useState(initialSample?.text ?? "");

  const preview = useMemo(() => {
    const baseConfig = migrateChartConfig({
      ...chartConfig,
      enabled: true,
      parseMode,
      framePrefix,
      delimiter,
      regexPattern,
      regexFlags,
      modbusRtu,
      canBus,
      binaryProtocol,
      channels: parseMode === "slcan" ? canChannels : [],
    });
    return previewChartParser(baseConfig, samples, sampleText);
  }, [
    canBus,
    canChannels,
    binaryProtocol,
    chartConfig,
    delimiter,
    framePrefix,
    modbusRtu,
    parseMode,
    regexFlags,
    regexPattern,
    sampleText,
    samples,
  ]);

  const apply = () => {
    if (!preview.success || incompatibleSource) return;
    const channels =
      parseMode === "slcan" ? canChannels : resolveAppliedParserChannels(chartConfig.channels, preview.config.channels);
    const channelKeysChanged = haveChannelKeysChanged(chartConfig.channels, channels);
    setChartConfig({
      ...chartConfig,
      enabled: true,
      parseMode,
      framePrefix,
      delimiter: parseMode === "auto" ? preview.config.delimiter : delimiter,
      regexPattern,
      regexFlags,
      modbusRtu: preview.config.modbusRtu,
      canBus,
      binaryProtocol,
      channels,
    });
    if (channelKeysChanged) clearChartData?.();
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={onClose} title="返回通道列表">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">数据解析</div>
          <div className="text-xs text-muted-foreground">预览当前串口样本</div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title="查看输入格式参考">
              <CircleHelp className="h-4 w-4" />
              <span className="sr-only">查看输入格式参考</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="left" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3">
            <div>
              <div className="text-sm font-semibold">输入格式参考</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                每行数据会先解析为数值通道；预览里的字段名就是组件需要绑定的通道 key。
              </p>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ["JSON", '{"temp":25.3,"voltage":3.3}'],
                ["KV", "temp=25.3,voltage=3.3 或 temp:25.3,voltage:3.3"],
                ["分隔符", "25.3,3.3"],
                ["正则", "temp:(?<temp>-?\\d+(?:\\.\\d+)?)"],
                ["JustFloat", "little-endian float32 + 00 00 80 7F"],
                ["通用二进制", "帧头 + 长度/帧尾 + 字段 + CRC"],
                ["CAN / SLCAN", "t1238AABBCCDDEEFF0011\\r 或 b1239AABB...\\r"],
                ["Modbus RTU", "03/04 读寄存器响应 + CRC16"],
                ["Modbus ASCII", "冒号帧头 + ASCII Hex + LRC + CRLF"],
                ["Modbus TCP", "MBAP 头 + 03/04 读寄存器响应"],
              ].map(([label, example]) => (
                <div key={label}>
                  <div className="mb-1 font-medium text-muted-foreground">{label}</div>
                  <code className="block overflow-x-auto rounded-lg bg-muted px-2 py-1.5 font-mono text-[11px]">
                    {example}
                  </code>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={() =>
                void open(`${DATA_FORMAT_DOC_URL}?id=${parseMode}`).catch((error) =>
                  console.error("打开数据格式文档失败:", error)
                )
              }
            >
              查看完整文档
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {allowDataFilter && (
          <ChartConfigDialog
            chartConfig={chartConfig}
            setChartConfig={setChartConfig}
            title="串口图表设置"
            allowDataFilter
            allowParserConfig={false}
            initialSection="filter"
            trigger={
              <Button
                variant={chartConfig.dataFilter.enabled ? "secondary" : "outline"}
                className="w-full justify-start gap-2"
              >
                <Settings2 className="h-4 w-4" />
                图表配置
              </Button>
            }
          />
        )}

        <div className="space-y-2">
          <Label>解析模式</Label>
          <Select value={parseMode} onValueChange={(value: ParseMode) => setParseMode(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动识别</SelectItem>
              {listChartParsers()
                .filter((parser) => parser.kind === "text" || allowBytesParsers)
                .map((parser) => (
                  <SelectItem key={parser.id} value={parser.id}>
                    {parser.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {parseMode === "delimiter" && (
          <div className="space-y-2">
            <Label htmlFor="parser-delimiter">分隔符</Label>
            <Input
              id="parser-delimiter"
              value={delimiter}
              onChange={(event) => setDelimiter(event.target.value)}
              placeholder=", / \t / ; / 空格"
              className="font-mono"
            />
          </div>
        )}

        {modbusMode && (
          <div className="space-y-3 rounded-[16px] border border-border/60 p-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <div>
                <Label htmlFor="modbus-auto-poll">自动轮询</Label>
              </div>
              <Switch
                id="modbus-auto-poll"
                checked={modbusRtu.autoPoll}
                onCheckedChange={(autoPoll) => setModbusRtu({ ...modbusRtu, autoPoll })}
              />
            </div>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))" }}
            >
              <div className="space-y-2">
                <Label htmlFor="modbus-slave">{parseMode === "modbus-tcp" ? "单元标识" : "从站地址"}</Label>
                <Input
                  id="modbus-slave"
                  type="number"
                  min={parseMode === "modbus-tcp" ? 0 : 1}
                  max={parseMode === "modbus-tcp" ? 255 : 247}
                  value={modbusRtu.slaveId}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, slaveId: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>功能码</Label>
                <Select
                  value={String(modbusRtu.functionCode)}
                  onValueChange={(value) => setModbusRtu({ ...modbusRtu, functionCode: value === "4" ? 4 : 3 })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">03 保持寄存器</SelectItem>
                    <SelectItem value="4">04 输入寄存器</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="modbus-start">起始地址</Label>
                <Input
                  id="modbus-start"
                  type="number"
                  min={0}
                  max={65535}
                  value={modbusRtu.startAddress}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, startAddress: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modbus-count">寄存器数量</Label>
                <Input
                  id="modbus-count"
                  type="number"
                  min={1}
                  max={125}
                  value={modbusRtu.registerCount}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, registerCount: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modbus-interval">轮询周期 (ms)</Label>
                <Input
                  id="modbus-interval"
                  type="number"
                  min={20}
                  max={60000}
                  value={modbusRtu.pollIntervalMs}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, pollIntervalMs: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>数据类型</Label>
                <Select
                  value={modbusRtu.dataType}
                  onValueChange={(value: ModbusDataType) => {
                    const width = value === "uint16" || value === "int16" ? 1 : 2;
                    const registerCount = Math.max(width, modbusRtu.registerCount - (modbusRtu.registerCount % width));
                    setModbusRtu({ ...modbusRtu, dataType: value, registerCount });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uint16">uint16</SelectItem>
                    <SelectItem value="int16">int16</SelectItem>
                    <SelectItem value="uint32">uint32</SelectItem>
                    <SelectItem value="int32">int32</SelectItem>
                    <SelectItem value="float32">float32</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>字节序</Label>
                <Select
                  value={modbusRtu.byteOrder}
                  onValueChange={(byteOrder: "big" | "little") => setModbusRtu({ ...modbusRtu, byteOrder })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="big">大端 (AB)</SelectItem>
                    <SelectItem value="little">小端 (BA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>字序</Label>
                <Select
                  value={modbusRtu.wordOrder}
                  disabled={modbusRtu.dataType === "uint16" || modbusRtu.dataType === "int16"}
                  onValueChange={(wordOrder: "big" | "little") => setModbusRtu({ ...modbusRtu, wordOrder })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="big">高字在前 (ABCD)</SelectItem>
                    <SelectItem value="little">低字在前 (CDAB)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="modbus-scale">比例</Label>
                <Input
                  id="modbus-scale"
                  type="number"
                  step="any"
                  value={modbusRtu.scale}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, scale: Number(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modbus-offset">偏移</Label>
                <Input
                  id="modbus-offset"
                  type="number"
                  step="any"
                  value={modbusRtu.offset}
                  onChange={(event) => setModbusRtu({ ...modbusRtu, offset: Number(event.target.value) })}
                />
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              地址按协议原始值（从 0 开始）填写；一个读取块使用统一数据类型与缩放。
            </p>
          </div>
        )}

        {parseMode === "slcan" && (
          <CanSignalEditor
            canBus={canBus}
            channels={canChannels}
            onCanBusChange={setCanBus}
            onChannelsChange={setCanChannels}
          />
        )}

        {parseMode === "binary" && (
          <div className="space-y-2">
            <Label htmlFor="parser-binary-protocol">已保存协议</Label>
            <Select
              value={
                savedBinaryProtocols.some(({ name }) => name === binaryProtocol.name) ? binaryProtocol.name : undefined
              }
              onValueChange={(name) => {
                const protocol = savedBinaryProtocols.find((saved) => saved.name === name);
                if (protocol) setBinaryProtocol(protocol);
              }}
              disabled={savedBinaryProtocols.length === 0}
            >
              <SelectTrigger id="parser-binary-protocol">
                <SelectValue placeholder={savedBinaryProtocols.length > 0 ? "选择协议" : "暂无保存协议"} />
              </SelectTrigger>
              <SelectContent>
                {savedBinaryProtocols.map((protocol) => (
                  <SelectItem key={protocol.name} value={protocol.name}>
                    {protocol.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <BinaryProtocolDesigner
              value={binaryProtocol}
              onChange={setBinaryProtocol}
              onLibraryChange={setSavedBinaryProtocols}
              samples={samples}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              支持固定长度、长度字段或帧尾分帧，并把消息字段转换成数值通道。
            </p>
          </div>
        )}

        {!isBytesParseMode(parseMode) && (
          <div className="space-y-2">
            <Label htmlFor="parser-frame-prefix">数据帧前缀（可选）</Label>
            <Input
              id="parser-frame-prefix"
              value={framePrefix}
              onChange={(event) => {
                const value = event.target.value;
                setFramePrefix(value);
                const matchingSample = [...samples].reverse().find((sample) => !value || sample.text.startsWith(value));
                if (matchingSample) setSampleText(matchingSample.text);
              }}
              placeholder="例如 P: 或 @PLOT:"
              className="font-mono"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              只解析以此前缀开头的文本；匹配后会剥离前缀，原始日志仍完整显示。
            </p>
          </div>
        )}

        {parseMode === "regex" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="parser-regex">正则表达式</Label>
              <Input
                id="parser-regex"
                value={regexPattern}
                onChange={(event) => setRegexPattern(event.target.value)}
                placeholder="temp:(?<temp>\\d+\\.\\d+)"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parser-flags">标志</Label>
              <Input
                id="parser-flags"
                value={regexFlags}
                onChange={(event) => setRegexFlags(event.target.value)}
                placeholder="g / gi"
              />
            </div>
          </div>
        )}

        {!isBytesParseMode(parseMode) && (
          <div className="space-y-2">
            <Label htmlFor="parser-sample">数据样本</Label>
            <textarea
              id="parser-sample"
              value={sampleText}
              onChange={(event) => setSampleText(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-[14px] border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
              placeholder="接收串口数据后会自动填入最近一条 RX 样本"
            />
          </div>
        )}

        {incompatibleSource && (
          <div className="flex items-start gap-2 rounded-[16px] border border-amber-500/25 bg-amber-500/10 p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {parseMode === "modbus-tcp"
                ? "Modbus TCP 只能用于 TCP 数据源，请先在连接页切换为 TCP。"
                : "模拟数据源不能使用 Modbus 主站模式。"}
            </span>
          </div>
        )}

        <div
          className={`rounded-[16px] border p-3 ${preview.success ? "border-green-500/25 bg-green-500/10" : "border-amber-500/25 bg-amber-500/10"}`}
        >
          <div className="flex items-start gap-2 text-sm font-medium leading-5">
            {preview.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600" />
            )}
            {preview.message}
          </div>
          {Object.keys(preview.values).length > 0 && (
            <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
              {Object.entries(preview.values).map(([key, value]) => (
                <div key={key} className="flex min-w-0 justify-between gap-3">
                  <span className="min-w-0 break-all">{key}</span>
                  <span className="shrink-0">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/60 p-3">
        <Button variant="outline" className="w-full" onClick={onClose}>
          取消
        </Button>
        <Button className="w-full" onClick={apply} disabled={!preview.success || incompatibleSource}>
          应用解析
        </Button>
      </div>
    </div>
  );
}
