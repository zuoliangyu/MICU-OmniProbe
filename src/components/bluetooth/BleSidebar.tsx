import { useState, useCallback, useEffect } from "react";
import { RefreshCw, Bluetooth, Sparkles, Radio, Edit3, Plug2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useBluetoothStore, pickDefaultNotifyChar, pickDefaultWriteChar } from "@/stores/bluetoothStore";
import { useBluetoothStats } from "@/hooks/useBluetoothEvents";
import { useLogStore } from "@/stores/logStore";
import { useSerialStore } from "@/stores/serialStore";
import { useAppStore } from "@/stores/appStore";
import {
  bleStartScan,
  bleStopScan,
  bleConnect,
  bleDisconnect,
  bleListServices,
  bleDetectNus,
  bleSubscribe,
  bleUnsubscribe,
  listSerialPorts,
  connectSerial,
  disconnectSerial,
  startSerial,
  stopSerial,
} from "@/lib/tauri";
import type { BleCharacteristic, BleDeviceInfo, BluetoothConnectionMode } from "@/lib/bleTypes";
import type { SerialPortInfo } from "@/lib/serialTypes";
import { filterBluetoothSppPorts } from "@/lib/bluetoothSpp";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";

const SCAN_TIMEOUT_MS = 6000;

export function BleSidebar() {
  const {
    connectionMode,
    sppPorts,
    sppLoading,
    scanning,
    connecting,
    connected,
    running,
    discoveredDevices,
    connectedDevice,
    services,
    notifyCharUuid,
    writeCharUuid,
    setConnectionMode,
    setSppPorts,
    setSppLoading,
    setScanning,
    setConnecting,
    setConnected,
    setRunning,
    setError,
    setDiscoveredDevices,
    setConnectedDevice,
    setServices,
    setNotifyCharUuid,
    setWriteCharUuid,
  } = useBluetoothStore(
    useShallow((state) => ({
      connectionMode: state.connectionMode,
      sppPorts: state.sppPorts,
      sppLoading: state.sppLoading,
      scanning: state.scanning,
      connecting: state.connecting,
      connected: state.connected,
      running: state.running,
      discoveredDevices: state.discoveredDevices,
      connectedDevice: state.connectedDevice,
      services: state.services,
      notifyCharUuid: state.notifyCharUuid,
      writeCharUuid: state.writeCharUuid,
      setConnectionMode: state.setConnectionMode,
      setSppPorts: state.setSppPorts,
      setSppLoading: state.setSppLoading,
      setScanning: state.setScanning,
      setConnecting: state.setConnecting,
      setConnected: state.setConnected,
      setRunning: state.setRunning,
      setError: state.setError,
      setDiscoveredDevices: state.setDiscoveredDevices,
      setConnectedDevice: state.setConnectedDevice,
      setServices: state.setServices,
      setNotifyCharUuid: state.setNotifyCharUuid,
      setWriteCharUuid: state.setWriteCharUuid,
    }))
  );

  const addLog = useLogStore((s) => s.addLog);

  const [busy, setBusy] = useState(false);

  const handleScan = useCallback(async () => {
    if (scanning) {
      try {
        await bleStopScan();
      } catch (error) {
        addLog("warn", `停止扫描失败: ${error}`);
      }
      setScanning(false);
      return;
    }

    try {
      setScanning(true);
      addLog("info", "开始扫描 BLE 设备...");
      const devices = await bleStartScan(SCAN_TIMEOUT_MS);
      setDiscoveredDevices(devices);
      addLog("success", `扫描完成，发现 ${devices.length} 个设备`);
    } catch (error) {
      addLog("error", `扫描失败: ${error}`);
    } finally {
      setScanning(false);
    }
  }, [addLog, scanning, setDiscoveredDevices, setScanning]);

  const loadServicesAfterConnect = useCallback(async () => {
    try {
      const list = await bleListServices();
      setServices(list);

      // 优先识别 NUS
      try {
        const nus = await bleDetectNus();
        if (nus) {
          setNotifyCharUuid(nus.notify_char_uuid);
          setWriteCharUuid(nus.write_char_uuid);
          addLog("success", "已自动识别 Nordic UART Service");
          return;
        }
      } catch {
        /* ignore */
      }

      // 否则按属性挑默认
      const defNotify = pickDefaultNotifyChar(list);
      const defWrite = pickDefaultWriteChar(list);
      if (defNotify) setNotifyCharUuid(defNotify);
      if (defWrite) setWriteCharUuid(defWrite);
    } catch (error) {
      addLog("error", `获取服务失败: ${error}`);
    }
  }, [addLog, setNotifyCharUuid, setServices, setWriteCharUuid]);

  const handleConnect = useCallback(
    async (device: BleDeviceInfo) => {
      try {
        setConnecting(true);
        addLog("info", `连接 ${device.name || device.address}...`);
        const info = await bleConnect(device.id);
        setConnectedDevice(info);
        setConnected(true);
        addLog("success", `已连接 ${info.name || info.address}`);
        await loadServicesAfterConnect();
      } catch (error) {
        addLog("error", `连接失败: ${error}`);
        setError(String(error));
      } finally {
        setConnecting(false);
      }
    },
    [addLog, loadServicesAfterConnect, setConnected, setConnectedDevice, setConnecting, setError]
  );

  const handleDisconnect = useCallback(async () => {
    try {
      setBusy(true);
      if (running) {
        await bleUnsubscribe();
        setRunning(false);
      }
      await bleDisconnect();
      setConnected(false);
      setConnectedDevice(null);
      setServices([]);
      setNotifyCharUuid(null);
      setWriteCharUuid(null);
      addLog("info", "BLE 已断开");
    } catch (error) {
      addLog("error", `断开失败: ${error}`);
    } finally {
      setBusy(false);
    }
  }, [addLog, running, setConnected, setConnectedDevice, setNotifyCharUuid, setRunning, setServices, setWriteCharUuid]);

  const handleStartNotify = useCallback(async () => {
    if (!notifyCharUuid) {
      addLog("error", "请先选择一个 Notify 特征值");
      return;
    }
    try {
      setBusy(true);
      await bleSubscribe(notifyCharUuid);
      setRunning(true);
      addLog("success", "已开始接收 BLE 数据");
    } catch (error) {
      addLog("error", `订阅失败: ${error}`);
    } finally {
      setBusy(false);
    }
  }, [addLog, notifyCharUuid, setRunning]);

  const handleStopNotify = useCallback(async () => {
    try {
      setBusy(true);
      await bleUnsubscribe();
      setRunning(false);
      addLog("info", "已停止 BLE 数据接收");
    } catch (error) {
      addLog("error", `取消订阅失败: ${error}`);
    } finally {
      setBusy(false);
    }
  }, [addLog, setRunning]);

  // ===== SPP =====
  const refreshSppPorts = useCallback(async () => {
    try {
      setSppLoading(true);
      const all = await listSerialPorts();
      const filtered = filterBluetoothSppPorts(all);
      setSppPorts(filtered);
      if (filtered.length === 0) {
        addLog("info", "未找到经典蓝牙 SPP 虚拟串口；请先在系统蓝牙设置中配对设备");
      } else {
        addLog("success", `检测到 ${filtered.length} 个蓝牙 SPP 端口`);
      }
    } catch (error) {
      addLog("error", `枚举串口失败: ${error}`);
    } finally {
      setSppLoading(false);
    }
  }, [addLog, setSppLoading, setSppPorts]);

  const handleConnectSpp = useCallback(
    async (port: SerialPortInfo) => {
      try {
        setBusy(true);

        const serialState = useSerialStore.getState();
        const baseConfig = serialState.localConfig;

        // 如果当前串口已连接（可能连着别的 COM），先断开
        if (serialState.connected) {
          if (serialState.running) {
            try {
              await stopSerial();
            } catch (e) {
              addLog("warn", `停止旧串口轮询失败: ${e}`);
            }
            serialState.setRunning(false);
          }
          try {
            await disconnectSerial();
          } catch (e) {
            addLog("warn", `断开旧串口失败: ${e}`);
          }
          serialState.setConnected(false);
        }

        // 用现有串口默认参数 + 当前选中的 SPP 端口
        const cfg = {
          ...baseConfig,
          type: "local" as const,
          port: port.name,
        };

        // 同步到 serialStore：以后用户回到串口模式仍然看到该端口
        serialState.setLocalConfig({ port: port.name });
        serialState.setActiveSourceType("local");

        addLog("info", `通过蓝牙 SPP 连接 ${port.name} (${baseConfig.baud_rate} bps)...`);
        await connectSerial(cfg);
        serialState.setConnected(true);
        await startSerial(10);
        serialState.setRunning(true);
        addLog("success", `已连接 ${port.name}，已切换到串口模式`);

        // 切到串口模式
        useAppStore.getState().setMode("serial");
      } catch (error) {
        addLog("error", `连接失败: ${error}`);
      } finally {
        setBusy(false);
      }
    },
    [addLog]
  );

  // 进入 SPP 模式时自动刷一次
  useEffect(() => {
    if (connectionMode === "spp" && sppPorts.length === 0 && !sppLoading) {
      void refreshSppPorts();
    }
    // 仅在模式切到 SPP 的瞬间触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionMode]);

  return (
    <aside className="surface-sidebar h-full w-full space-y-0 overflow-y-auto rounded-[32px] p-4">
      {/* 工作模式切换 */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm">工作模式</CardTitle>
          <CardDescription className="text-xs">
            {connectionMode === "ble"
              ? "BLE 中央设备：扫描、连接、订阅 Notify"
              : "经典蓝牙 SPP：使用系统已配对的虚拟 COM"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={connectionMode}
            onValueChange={(v) => setConnectionMode(v as BluetoothConnectionMode)}
            className="space-y-2"
            disabled={connecting || running}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="ble" id="ble-mode" />
              <Label htmlFor="ble-mode" className="flex cursor-pointer items-center gap-2">
                <Bluetooth className="h-4 w-4" />
                BLE
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="spp" id="spp-mode" />
              <Label htmlFor="spp-mode" className="flex cursor-pointer items-center gap-2">
                <Plug2 className="h-4 w-4" />
                经典蓝牙 SPP
              </Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {connectionMode === "spp" && (
        <SppPortsCard
          ports={sppPorts}
          loading={sppLoading}
          busy={busy}
          onRefresh={refreshSppPorts}
          onConnect={handleConnectSpp}
        />
      )}

      {connectionMode === "ble" && (
        <>
          {/* 扫描卡片 */}
          <Card>
            <CardHeader className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">设备扫描</CardTitle>
                  <CardDescription className="text-xs">
                    {scanning ? "正在扫描..." : `已发现 ${discoveredDevices.length} 台 BLE 设备`}
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={scanning ? "destructive" : "outline"}
                  className="h-7 gap-1 rounded-full px-3 text-xs"
                  onClick={handleScan}
                  disabled={connecting}
                >
                  {scanning ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      停止
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      扫描
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {discoveredDevices.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-border/70 bg-white/40 px-3 py-4 text-center text-xs text-muted-foreground">
                  点击「扫描」开始查找附近的 BLE 设备
                </div>
              ) : (
                discoveredDevices.map((device) => {
                  const isConnected = connectedDevice?.id === device.id;
                  return (
                    <button
                      key={device.id}
                      onClick={() => !isConnected && handleConnect(device)}
                      disabled={connecting || isConnected}
                      className={cn(
                        "group flex w-full items-center justify-between gap-2 rounded-[18px] border px-3 py-2 text-left transition-colors",
                        isConnected
                          ? "border-primary bg-primary/8 text-foreground"
                          : "border-border/60 bg-white/65 hover:border-primary/50 hover:bg-primary/5"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Bluetooth className="h-3.5 w-3.5 text-primary" />
                          <span className="truncate text-xs font-medium">{device.name || "(无名)"}</span>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {device.address || device.id}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {device.rssi !== null && (
                          <div className="text-[10px] text-muted-foreground">{device.rssi} dBm</div>
                        )}
                        {isConnected && <div className="text-[10px] font-medium text-primary">已连接</div>}
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* 已连接设备 + 特征值选择 */}
          {connected && connectedDevice && (
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-sm">特征值</CardTitle>
                <CardDescription className="text-xs">
                  共 {services.length} 个服务，选择 Notify / Write 特征值
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {services.length === 0 ? (
                  <div className="text-xs text-muted-foreground">未发现服务</div>
                ) : (
                  services.map((service) => (
                    <div key={service.uuid} className="space-y-1">
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {shortUuid(service.uuid)}
                      </div>
                      <div className="space-y-1 pl-2">
                        {service.characteristics.map((c) => (
                          <CharRow
                            key={c.uuid}
                            char={c}
                            isNotify={c.uuid === notifyCharUuid}
                            isWrite={c.uuid === writeCharUuid}
                            onSelectNotify={() => setNotifyCharUuid(c.uuid)}
                            onSelectWrite={() => setWriteCharUuid(c.uuid)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {/* 操作按钮 */}
          {connected && (
            <div className="flex flex-col gap-2">
              {!running ? (
                <Button className="w-full rounded-full" onClick={handleStartNotify} disabled={busy || !notifyCharUuid}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  开始接收 (Notify)
                </Button>
              ) : (
                <Button variant="outline" className="w-full rounded-full" onClick={handleStopNotify} disabled={busy}>
                  停止接收
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/15"
                onClick={handleDisconnect}
                disabled={busy}
              >
                断开 BLE 设备
              </Button>
            </div>
          )}

          {/* 统计 */}
          {connected && (
            <Card>
              <CardHeader className="py-4">
                <CardTitle className="text-sm">统计信息</CardTitle>
              </CardHeader>
              <BleStatsContent />
            </Card>
          )}
        </>
      )}
    </aside>
  );
}

interface SppPortsCardProps {
  ports: SerialPortInfo[];
  loading: boolean;
  busy: boolean;
  onRefresh: () => void | Promise<void>;
  onConnect: (port: SerialPortInfo) => void | Promise<void>;
}

function SppPortsCard({ ports, loading, busy, onRefresh, onConnect }: SppPortsCardProps) {
  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">SPP 虚拟串口</CardTitle>
            <CardDescription className="text-xs">
              {loading ? "正在枚举..." : `检测到 ${ports.length} 个蓝牙 SPP 端口`}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-full px-3 text-xs"
            onClick={() => void onRefresh()}
            disabled={loading || busy}
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div className="rounded-[18px] border border-dashed border-border/70 bg-white/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          SPP 设备需先在系统蓝牙设置中**配对**，配对后才会被映射成虚拟
          COM；点击下方按钮会用串口模块连接并跳转到串口工作台。
        </div>
        {ports.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border/70 bg-white/40 px-3 py-4 text-center text-xs text-muted-foreground">
            未检测到蓝牙 SPP 端口；请在系统中配对设备后点击「刷新」
          </div>
        ) : (
          ports.map((port) => (
            <div
              key={port.name}
              className="flex items-center justify-between gap-2 rounded-[18px] border border-border/60 bg-white/65 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Plug2 className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate text-xs font-medium">{port.name}</span>
                </div>
                {port.description && (
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{port.description}</div>
                )}
              </div>
              <Button
                size="sm"
                className="h-7 gap-1 rounded-full px-3 text-xs"
                onClick={() => void onConnect(port)}
                disabled={busy}
              >
                连接
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function shortUuid(uuid: string): string {
  // 标准 16-bit 蓝牙 UUID 形如 0000xxxx-0000-1000-8000-00805f9b34fb
  const m = uuid.match(/^0000([0-9a-fA-F]{4})-0000-1000-8000-00805f9b34fb$/);
  if (m) return `0x${m[1].toUpperCase()} (16-bit)`;
  return uuid;
}

/** 统计随每批数据变化，单独订阅，避免整个侧栏跟着数据流按帧重渲染。 */
function BleStatsContent() {
  const stats = useBluetoothStats();
  return (
    <CardContent className="space-y-1 text-xs">
      <Stat label="接收" value={stats.bytesReceivedFormatted} />
      <Stat label="发送" value={stats.bytesSentFormatted} />
      <Stat label="行数" value={String(stats.lineCount)} />
    </CardContent>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

interface CharRowProps {
  char: BleCharacteristic;
  isNotify: boolean;
  isWrite: boolean;
  onSelectNotify: () => void;
  onSelectWrite: () => void;
}

function CharRow({ char, isNotify, isWrite, onSelectNotify, onSelectWrite }: CharRowProps) {
  const canNotify = char.properties.notify || char.properties.indicate;
  const canWrite = char.properties.write || char.properties.write_without_response;

  return (
    <div
      className={cn(
        "rounded-[14px] border px-2 py-1.5 text-[11px]",
        isNotify || isWrite ? "border-primary/60 bg-primary/5" : "border-border/60 bg-white/55"
      )}
    >
      <div className="truncate font-mono text-[10px] text-foreground">{shortUuid(char.uuid)}</div>
      <div className="mt-1 flex items-center gap-1">
        {char.properties.read && <Tag>R</Tag>}
        {char.properties.write && <Tag>W</Tag>}
        {char.properties.write_without_response && <Tag>WnR</Tag>}
        {char.properties.notify && <Tag>Notify</Tag>}
        {char.properties.indicate && <Tag>Indicate</Tag>}
      </div>
      <div className="mt-1.5 flex gap-1">
        <Button
          size="sm"
          variant={isNotify ? "default" : "ghost"}
          className="h-6 gap-1 rounded-full px-2 text-[10px]"
          onClick={onSelectNotify}
          disabled={!canNotify}
        >
          <Radio className="h-3 w-3" />
          作为 Notify
        </Button>
        <Button
          size="sm"
          variant={isWrite ? "default" : "ghost"}
          className="h-6 gap-1 rounded-full px-2 text-[10px]"
          onClick={onSelectWrite}
          disabled={!canWrite}
        >
          <Edit3 className="h-3 w-3" />
          作为 Write
        </Button>
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
      {children}
    </span>
  );
}
