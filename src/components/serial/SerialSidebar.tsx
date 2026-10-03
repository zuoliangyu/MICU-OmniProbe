import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, ChevronDown, ChevronRight, Plug2, Wifi, Radio, Waves, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useSerialStore } from "@/stores/serialStore";
import { useSerialStats } from "@/hooks/useSerialEvents";
import { useLogStore } from "@/stores/logStore";
import { listSerialPorts, connectSerial, disconnectSerial, startSerial, stopSerial } from "@/lib/tauri";
import {
  COMMON_BAUD_RATES,
  type SerialPortInfo,
  type DataSourceType,
  type SimulationPreset,
  type SimulationWaveform,
  type SimulationXyPattern,
  type SerialLine,
  type Encoding,
} from "@/lib/serialTypes";
import { createSimulationSample, startSerialSimulation, stopSerialSimulation } from "@/lib/serialSimulation";
import { useShallow } from "zustand/react/shallow";
import { ChartParserPanel } from "@/components/rtt/ChartParserPanel";
import { cn } from "@/lib/utils";

/** 稳定的空数组引用：解析面板不可见时用它替代 lines，避免订阅到每帧都换 identity 的大数组。 */
const NO_SAMPLE_LINES: SerialLine[] = [];
const USB_REFRESH_DELAY_MS = 500;

const parsePort = (value: string) => Math.min(65535, Math.max(0, parseInt(value) || 0));

export function SerialSidebar() {
  const {
    connected,
    connecting,
    running,
    localConfig,
    tcpConfig,
    udpConfig,
    simulationConfig,
    activeSourceType,
    displayMode,
    rxFraming,
    sendSettings,
    chartConfig,
    inspectorTab,
    setConnected,
    setConnecting,
    setRunning,
    setError,
    setLocalConfig,
    setTcpConfig,
    setUdpConfig,
    setSimulationConfig,
    setActiveSourceType,
    setDisplayMode,
    setRxFraming,
    setSendSettings,
    setChartConfig,
    clearChartData,
    setInspectorTab,
    getActiveConfig,
  } = useSerialStore(
    useShallow((state) => ({
      connected: state.connected,
      connecting: state.connecting,
      running: state.running,
      localConfig: state.localConfig,
      tcpConfig: state.tcpConfig,
      udpConfig: state.udpConfig,
      simulationConfig: state.simulationConfig,
      activeSourceType: state.activeSourceType,
      displayMode: state.displayMode,
      rxFraming: state.rxFraming,
      sendSettings: state.sendSettings,
      chartConfig: state.chartConfig,
      inspectorTab: state.inspectorTab,
      setConnected: state.setConnected,
      setConnecting: state.setConnecting,
      setRunning: state.setRunning,
      setError: state.setError,
      setLocalConfig: state.setLocalConfig,
      setTcpConfig: state.setTcpConfig,
      setUdpConfig: state.setUdpConfig,
      setSimulationConfig: state.setSimulationConfig,
      setActiveSourceType: state.setActiveSourceType,
      setDisplayMode: state.setDisplayMode,
      setRxFraming: state.setRxFraming,
      setSendSettings: state.setSendSettings,
      setChartConfig: state.setChartConfig,
      clearChartData: state.clearChartData,
      setInspectorTab: state.setInspectorTab,
      getActiveConfig: state.getActiveConfig,
    }))
  );

  const chartSampleLines = useSerialStore((state) => (inspectorTab === "data" ? state.lines : NO_SAMPLE_LINES));

  const addLog = useLogStore((state) => state.addLog);

  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [serialSettingsOpen, setSerialSettingsOpen] = useState(false);
  const [sendSettingsOpen, setSendSettingsOpen] = useState(false);

  // Refresh port list
  const refreshPorts = useCallback(async () => {
    try {
      setLoading(true);
      const portList = await listSerialPorts();
      setPorts(portList);

      // Auto-select first port if none selected
      // 当前端口从 store 现取：放进依赖会让每次切换端口都重扫并重注册 USB 监听
      if (portList.length > 0 && !useSerialStore.getState().localConfig.port) {
        setLocalConfig({ port: portList[0].name });
      }

      if (portList.length > 0) {
        addLog("info", `检测到 ${portList.length} 个串口`);
      }
    } catch (error) {
      addLog("error", `串口检测失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [setLocalConfig, addLog]);

  useEffect(() => {
    void refreshPorts();
  }, [refreshPorts]);

  useEffect(() => {
    let timer: number | undefined;
    const unlisten = listen("usb-device-changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshPorts(), USB_REFRESH_DELAY_MS);
    });

    return () => {
      window.clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, [refreshPorts]);

  // Connect/Disconnect
  const handleConnect = async () => {
    try {
      setConnecting(true);

      if (activeSourceType === "simulation") {
        const normalized = startSerialSimulation(simulationConfig);
        setSimulationConfig(normalized);
        setConnected(true);
        setRunning(true);
        addLog("success", "模拟数据已启动");
        return;
      }

      const config = getActiveConfig();

      if (activeSourceType === "local" && !localConfig.port) {
        addLog("error", "请先选择串口");
        return;
      }
      if (
        activeSourceType === "udp" &&
        (!udpConfig.local_host || !udpConfig.remote_host || udpConfig.remote_port < 1)
      ) {
        addLog("error", "请填写有效的 UDP 本地地址、远端地址和远端端口");
        return;
      }

      addLog(
        "info",
        `正在连接 ${
          activeSourceType === "local"
            ? localConfig.port
            : activeSourceType === "tcp"
              ? `${tcpConfig.host}:${tcpConfig.port}`
              : `${udpConfig.local_host}:${udpConfig.local_port} → ${udpConfig.remote_host}:${udpConfig.remote_port}`
        }...`
      );

      await connectSerial(config);
      setConnected(true);

      // Start polling automatically
      await startSerial(10);
      setRunning(true);

      addLog("success", `串口连接成功`);
    } catch (error) {
      addLog("error", `连接失败: ${error}`);
      setError(String(error));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (activeSourceType === "simulation") {
        stopSerialSimulation();
        setRunning(false);
        setConnected(false);
        addLog("info", "模拟数据已停止");
        return;
      }

      if (running) {
        await stopSerial();
        setRunning(false);
      }
      await disconnectSerial();
      setConnected(false);
      addLog("info", "串口已断开");
    } catch (error) {
      addLog("error", `断开失败: ${error}`);
    }
  };

  const sourceDescription =
    activeSourceType === "local"
      ? localConfig.port || "本地串口未选择"
      : activeSourceType === "tcp"
        ? `${tcpConfig.host}:${tcpConfig.port}`
        : activeSourceType === "udp"
          ? `${udpConfig.local_host}:${udpConfig.local_port} → ${udpConfig.remote_host}:${udpConfig.remote_port}`
          : "本机生成 JSON 测试数据";
  const simulationPreview = JSON.stringify(
    createSimulationSample(simulationConfig, simulationConfig.preset === "filter-demo" ? 0.05 : 0.5, () => 0.5)
  );
  // 解析面板只在「数据」页签下可见（其余情况仅用 CSS 隐藏，组件仍挂载）。
  // 只在可见时订阅 lines，否则整个侧边栏会跟着每批数据重渲染。
  const chartSamples = chartSampleLines
    .slice(-100)
    .filter((line) => line.direction === "rx")
    .slice(-20)
    .map(({ text, rawData }) => ({ text, rawData }));
  // 连接按钮不可用时直接说明缺少哪项配置
  const missingRequirement =
    activeSourceType === "local" && !localConfig.port
      ? ports.length === 0
        ? "未检测到串口，请插入设备后点击刷新"
        : "请先选择串口"
      : activeSourceType === "udp" && (!udpConfig.local_host || !udpConfig.remote_host || udpConfig.remote_port < 1)
        ? "请填写完整的 UDP 本地 / 远端地址"
        : null;

  return (
    <aside className="surface-sidebar flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[32px]">
      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/60 bg-white/45 p-2">
        {(
          [
            ["connection", "连接", Plug2],
            ["data", "数据", Braces],
          ] as const
        ).map(([tab, label, Icon]) => (
          <Button
            key={tab}
            type="button"
            size="sm"
            variant={inspectorTab === tab ? "secondary" : "ghost"}
            className="gap-1 px-2"
            onClick={() => setInspectorTab(tab)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      <div className={cn("min-h-0 flex-1 space-y-0 overflow-y-auto p-3", inspectorTab !== "connection" && "hidden")}>
        {/* Data Source Selection */}
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm">数据源</CardTitle>
            <CardDescription className="text-xs">{sourceDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <RadioGroup
              value={activeSourceType}
              onValueChange={(value) => setActiveSourceType(value as DataSourceType)}
              disabled={connected}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="local" id="local" />
                <Label htmlFor="local" className="flex items-center gap-2 cursor-pointer">
                  <Plug2 className="h-4 w-4" />
                  本地串口
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="udp" id="udp" />
                <Label htmlFor="udp" className="flex items-center gap-2 cursor-pointer">
                  <Radio className="h-4 w-4" />
                  UDP 数据接口
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="tcp" id="tcp" />
                <Label htmlFor="tcp" className="flex items-center gap-2 cursor-pointer">
                  <Wifi className="h-4 w-4" />
                  TCP 远程串口
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="simulation" id="simulation" />
                <Label htmlFor="simulation" className="flex items-center gap-2 cursor-pointer">
                  <Waves className="h-4 w-4" />
                  模拟数据
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Local Serial Config */}
        {activeSourceType === "local" && (
          <Card>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">串口配置</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    {localConfig.port ? `${localConfig.port} · ${localConfig.baud_rate} bps` : "选择端口并确认波特率"}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={refreshPorts}
                  disabled={loading || connected}
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">串口</label>
                <Select
                  value={localConfig.port}
                  onValueChange={(value) => setLocalConfig({ port: value })}
                  disabled={connected}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择串口" />
                  </SelectTrigger>
                  <SelectContent>
                    {ports.map((port) => (
                      <SelectItem key={port.name} value={port.name}>
                        <div className="flex flex-col">
                          <span>{port.name}</span>
                          {port.description && (
                            <span className="text-xs text-muted-foreground">{port.description}</span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">波特率</label>
                <Select
                  value={String(localConfig.baud_rate)}
                  onValueChange={(value) => setLocalConfig({ baud_rate: parseInt(value) })}
                  disabled={connected}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_BAUD_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate.toLocaleString()} bps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Local Serial Advanced Settings */}
        {activeSourceType === "local" && (
          <Collapsible open={serialSettingsOpen} onOpenChange={setSerialSettingsOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <CardHeader className="py-4 cursor-pointer hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm">高级设置</CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        {localConfig.data_bits}-{localConfig.stop_bits}-{localConfig.parity} ·{" "}
                        {localConfig.flow_control}
                        {localConfig.dtr && " · DTR"}
                        {localConfig.rts && " · RTS"}
                      </CardDescription>
                      {/* 树莓派 Pico 等 USB 虚拟串口需 DTR 才发送，用户常不展开这里，折叠状态下也要提示 */}
                      {!localConfig.dtr && <p className="mt-1 text-xs text-amber-600">收不到数据？展开开启 DTR 试试</p>}
                    </div>
                    {serialSettingsOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground">数据位</label>
                    <Select
                      value={String(localConfig.data_bits)}
                      onValueChange={(value) => setLocalConfig({ data_bits: parseInt(value) as 5 | 6 | 7 | 8 })}
                      disabled={connected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 位</SelectItem>
                        <SelectItem value="6">6 位</SelectItem>
                        <SelectItem value="7">7 位</SelectItem>
                        <SelectItem value="8">8 位</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground">停止位</label>
                    <Select
                      value={String(localConfig.stop_bits)}
                      onValueChange={(value) => setLocalConfig({ stop_bits: parseInt(value) as 1 | 2 })}
                      disabled={connected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 位</SelectItem>
                        <SelectItem value="2">2 位</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground">校验位</label>
                    <Select
                      value={localConfig.parity}
                      onValueChange={(value) => setLocalConfig({ parity: value as "none" | "even" | "odd" })}
                      disabled={connected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">无</SelectItem>
                        <SelectItem value="even">偶校验</SelectItem>
                        <SelectItem value="odd">奇校验</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground">流控</label>
                    <Select
                      value={localConfig.flow_control}
                      onValueChange={(value) =>
                        setLocalConfig({ flow_control: value as "none" | "hardware" | "software" })
                      }
                      disabled={connected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">无</SelectItem>
                        <SelectItem value="hardware">硬件 (RTS/CTS)</SelectItem>
                        <SelectItem value="software">软件 (XON/XOFF)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="space-y-0.5">
                      <label className="text-xs font-medium">DTR</label>
                      <p className="text-xs text-muted-foreground">打开串口后拉高 DTR (默认关，USB 虚拟串口常需开启)</p>
                    </div>
                    <Switch
                      checked={localConfig.dtr ?? false}
                      onCheckedChange={(value) => setLocalConfig({ dtr: value })}
                      disabled={connected}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <label className="text-xs font-medium">RTS</label>
                      <p className="text-xs text-muted-foreground">
                        {localConfig.flow_control === "none"
                          ? "打开串口后拉高 RTS (默认关)"
                          : "硬件流控下由驱动接管，此项忽略"}
                      </p>
                    </div>
                    <Switch
                      checked={localConfig.rts ?? false}
                      onCheckedChange={(value) => setLocalConfig({ rts: value })}
                      disabled={connected || localConfig.flow_control !== "none"}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <label className="text-xs font-medium">断线自动重连</label>
                      <p className="text-xs text-muted-foreground">读取出错时尝试重连 (1s 起，指数退避到 5s)</p>
                    </div>
                    <Switch
                      checked={localConfig.reconnect ?? false}
                      onCheckedChange={(value) => setLocalConfig({ reconnect: value })}
                    />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {/* TCP Config */}
        {activeSourceType === "tcp" && (
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm">TCP 配置</CardTitle>
              <CardDescription className="text-xs">适合 ser2net、ESP-Link 等远程串口桥接场景。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">主机地址</label>
                <Input
                  value={tcpConfig.host}
                  onChange={(e) => setTcpConfig({ host: e.target.value })}
                  placeholder="192.168.1.1"
                  disabled={connected}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">端口号</label>
                <Input
                  type="number"
                  value={tcpConfig.port}
                  onChange={(e) => setTcpConfig({ port: parseInt(e.target.value) || 0 })}
                  placeholder="8080"
                  disabled={connected}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="space-y-0.5">
                  <label className="text-xs font-medium">断线自动重连</label>
                  <p className="text-xs text-muted-foreground">读取出错时尝试重连 (1s 起，指数退避到 5s)</p>
                </div>
                <Switch
                  checked={tcpConfig.reconnect ?? false}
                  onCheckedChange={(value) => setTcpConfig({ reconnect: value })}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* UDP Config */}
        {activeSourceType === "udp" && (
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm">UDP 配置</CardTitle>
              <CardDescription className="text-xs">绑定本地端点，并与指定远端端点双向收发数据。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">本地绑定地址</label>
                <Input
                  value={udpConfig.local_host}
                  onChange={(event) => setUdpConfig({ local_host: event.target.value })}
                  placeholder="0.0.0.0"
                  disabled={connected}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">本地端口</label>
                <Input
                  type="number"
                  min={0}
                  max={65535}
                  value={udpConfig.local_port}
                  onChange={(event) => setUdpConfig({ local_port: parsePort(event.target.value) })}
                  placeholder="9000"
                  disabled={connected}
                />
                <p className="mt-1 text-xs text-muted-foreground">填写 0 时由系统自动分配端口。</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">远端地址</label>
                <Input
                  value={udpConfig.remote_host}
                  onChange={(event) => setUdpConfig({ remote_host: event.target.value })}
                  placeholder="192.168.1.1"
                  disabled={connected}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">远端端口</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={udpConfig.remote_port}
                  onChange={(event) => setUdpConfig({ remote_port: parsePort(event.target.value) })}
                  placeholder="9000"
                  disabled={connected}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Simulation Config */}
        {activeSourceType === "simulation" && (
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm">模拟数据配置</CardTitle>
              <CardDescription className="text-xs">生成 JSON 行并走完整的串口接收与解析链路。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">信号预设</label>
                <Select
                  value={simulationConfig.preset}
                  onValueChange={(preset) =>
                    setSimulationConfig({
                      preset: preset as SimulationPreset,
                      ...(preset === "filter-demo" ? { sampleRateHz: 200 } : {}),
                    })
                  }
                  disabled={connected}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="waveform">通用波形</SelectItem>
                    <SelectItem value="filter-demo">滤波演示</SelectItem>
                    <SelectItem value="xy">XY 轨迹</SelectItem>
                    <SelectItem value="imu3">IMU 三轴姿态</SelectItem>
                    <SelectItem value="imu6">IMU 六轴</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {simulationConfig.preset === "waveform" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground">波形</label>
                    <Select
                      value={simulationConfig.waveform}
                      onValueChange={(waveform) => setSimulationConfig({ waveform: waveform as SimulationWaveform })}
                      disabled={connected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sine">正弦波</SelectItem>
                        <SelectItem value="square">方波</SelectItem>
                        <SelectItem value="triangle">三角波</SelectItem>
                        <SelectItem value="sawtooth">锯齿波</SelectItem>
                        <SelectItem value="noise">随机噪声</SelectItem>
                        <SelectItem value="constant">固定值</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">通道数（ch1–ch8）</label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      value={simulationConfig.channelCount}
                      onChange={(event) => setSimulationConfig({ channelCount: Number(event.target.value) })}
                      disabled={connected}
                    />
                  </div>
                </>
              )}

              {simulationConfig.preset === "xy" && (
                <div>
                  <label className="text-xs text-muted-foreground">轨迹</label>
                  <Select
                    value={simulationConfig.xyPattern}
                    onValueChange={(xyPattern) => setSimulationConfig({ xyPattern: xyPattern as SimulationXyPattern })}
                    disabled={connected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="circle">圆形</SelectItem>
                      <SelectItem value="lissajous">李萨如曲线</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {simulationConfig.preset !== "filter-demo" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">采样率（Hz）</label>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={simulationConfig.sampleRateHz}
                      onChange={(event) => setSimulationConfig({ sampleRateHz: Number(event.target.value) })}
                      disabled={connected}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">
                      {simulationConfig.preset === "imu3" || simulationConfig.preset === "imu6"
                        ? "运动频率（Hz）"
                        : "信号频率（Hz）"}
                    </label>
                    <Input
                      type="number"
                      min={0.01}
                      max={10}
                      step={0.01}
                      value={simulationConfig.frequencyHz}
                      onChange={(event) => setSimulationConfig({ frequencyHz: Number(event.target.value) })}
                      disabled={connected}
                    />
                  </div>
                </div>
              )}

              {simulationConfig.preset !== "filter-demo" &&
                simulationConfig.preset !== "imu3" &&
                simulationConfig.preset !== "imu6" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">幅值</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={simulationConfig.amplitude}
                        onChange={(event) => setSimulationConfig({ amplitude: Number(event.target.value) })}
                        disabled={connected}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">偏移</label>
                      <Input
                        type="number"
                        step={0.1}
                        value={simulationConfig.offset}
                        onChange={(event) => setSimulationConfig({ offset: Number(event.target.value) })}
                        disabled={connected}
                      />
                    </div>
                  </div>
                )}

              {simulationConfig.preset !== "filter-demo" && (
                <div>
                  <label className="text-xs text-muted-foreground">噪声强度</label>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={simulationConfig.noise}
                    onChange={(event) => setSimulationConfig({ noise: Number(event.target.value) })}
                    disabled={connected}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {simulationConfig.preset === "imu6"
                      ? "输出字段：ax、ay、az（g）和 gx、gy、gz（°/s）"
                      : simulationConfig.preset === "imu3"
                        ? "输出字段：roll、pitch、yaw（°）"
                        : simulationConfig.preset === "xy"
                          ? "输出字段：x、y"
                          : `输出字段：ch1–ch${simulationConfig.channelCount}`}
                  </p>
                </div>
              )}

              {simulationConfig.preset === "filter-demo" && (
                <p className="text-xs text-muted-foreground">
                  固定 200 Hz 采样，5 Hz 主信号 + 40 Hz 干扰，输出字段 signal。
                </p>
              )}

              <div className="rounded-md bg-muted/60 p-2">
                <p className="mb-1 text-xs text-muted-foreground">输出示例</p>
                <code className="block break-all text-xs leading-4">{simulationPreview}</code>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Receive / Send Settings */}
        <Collapsible open={sendSettingsOpen} onOpenChange={setSendSettingsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-4 cursor-pointer hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">收发设置</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      收 {displayMode === "hex" ? "HEX" : rxFraming.encoding.toUpperCase()} · 发{" "}
                      {sendSettings.hexMode ? "HEX" : sendSettings.encoding.toUpperCase()} /{" "}
                      {sendSettings.lineEnding.toUpperCase()}
                    </CardDescription>
                  </div>
                  {sendSettingsOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-xs font-medium">接收</div>
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                    {(["text", "hex"] as const).map((format) => (
                      <Button
                        key={format}
                        type="button"
                        size="sm"
                        variant={displayMode === format ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setDisplayMode(format)}
                      >
                        {format === "text" ? "文本" : "HEX"}
                      </Button>
                    ))}
                  </div>
                  <Select
                    value={rxFraming.encoding}
                    disabled={displayMode === "hex"}
                    onValueChange={(value) => setRxFraming({ encoding: value as Encoding })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utf-8">UTF-8</SelectItem>
                      <SelectItem value="ascii">ASCII</SelectItem>
                      <SelectItem value="gbk">GBK</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium">发送</div>
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                    {(["text", "hex"] as const).map((format) => (
                      <Button
                        key={format}
                        type="button"
                        size="sm"
                        variant={(sendSettings.hexMode ? "hex" : "text") === format ? "secondary" : "ghost"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setSendSettings({ hexMode: format === "hex" })}
                      >
                        {format === "text" ? "文本" : "HEX"}
                      </Button>
                    ))}
                  </div>
                  <Select
                    value={sendSettings.encoding}
                    disabled={sendSettings.hexMode}
                    onValueChange={(value) => setSendSettings({ encoding: value as Encoding })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="utf-8">UTF-8</SelectItem>
                      <SelectItem value="ascii">ASCII</SelectItem>
                      <SelectItem value="gbk">GBK</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground">发送换行符</label>
                  <Select
                    value={sendSettings.lineEnding}
                    disabled={sendSettings.hexMode}
                    onValueChange={(value) => setSendSettings({ lineEnding: value as "none" | "lf" | "crlf" | "cr" })}
                  >
                    <SelectTrigger className="mt-1 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无</SelectItem>
                      <SelectItem value="lf">LF (\n)</SelectItem>
                      <SelectItem value="crlf">CRLF (\r\n)</SelectItem>
                      <SelectItem value="cr">CR (\r)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Statistics */}
        {connected && (
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm">统计信息</CardTitle>
            </CardHeader>
            <SerialStatsContent />
          </Card>
        )}
      </div>

      <div className={cn("min-h-0 flex-1", inspectorTab !== "data" && "hidden")}>
        <ChartParserPanel
          chartConfig={chartConfig}
          samples={chartSamples}
          allowBytesParsers
          allowDataFilter
          dataSourceType={activeSourceType}
          setChartConfig={setChartConfig}
          clearChartData={clearChartData}
          onClose={() => setInspectorTab("connection")}
        />
      </div>

      {inspectorTab === "connection" && (
        <div className="inspector-action-bar shrink-0">
          {!connected && !connecting && missingRequirement && (
            <p className="pb-2 text-center text-xs text-muted-foreground">{missingRequirement}</p>
          )}
          <Button
            className={`w-full transition-all ${
              connected ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary hover:bg-primary/90"
            } ${connecting && "animate-pulse"}`}
            onClick={connected ? handleDisconnect : handleConnect}
            disabled={connecting || (!connected && missingRequirement !== null)}
          >
            {connecting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                连接中...
              </>
            ) : connected ? (
              activeSourceType === "simulation" ? (
                "停止模拟"
              ) : (
                "断开连接"
              )
            ) : activeSourceType === "simulation" ? (
              "启动模拟"
            ) : (
              "连接"
            )}
          </Button>
        </div>
      )}
    </aside>
  );
}

/** 统计随每批数据变化，单独订阅，避免整个侧栏跟着数据流按帧重渲染。 */
function SerialStatsContent() {
  const stats = useSerialStats();
  return (
    <CardContent className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">接收:</span>
        <span className="font-mono">{stats.bytesReceivedFormatted}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">发送:</span>
        <span className="font-mono">{stats.bytesSentFormatted}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">行数:</span>
        <span className="font-mono">{stats.lineCount}</span>
      </div>
    </CardContent>
  );
}
