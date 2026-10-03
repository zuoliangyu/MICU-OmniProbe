import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw, Plug, Unplug, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useProbeStore } from "@/stores/probeStore";
import { useChipStore } from "@/stores/chipStore";
import { useLogStore } from "@/stores/logStore";
import { useAppStore } from "@/stores/appStore";
import { listProbes, connectTarget, disconnect, searchChips, getChipInfo, getConnectionStatus } from "@/lib/tauri";
import { PackManager } from "@/components/config/PackManager";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const probes = useProbeStore((s) => s.probes);
  const selectedProbe = useProbeStore((s) => s.selectedProbe);
  const connected = useProbeStore((s) => s.connected);
  const connectionInfo = useProbeStore((s) => s.connectionInfo);
  // 调试工作台用工具栏的「连接」附加调试会话；这里不再重复提供一个语义不同的连接入口
  const debugMode = useAppStore((s) => s.mode === "debug");
  const settings = useProbeStore((s) => s.settings);
  const loading = useProbeStore((s) => s.loading);
  const error = useProbeStore((s) => s.error);
  const autoDisconnect = useProbeStore((s) => s.autoDisconnect);
  const autoDisconnectTimeout = useProbeStore((s) => s.autoDisconnectTimeout);
  const setProbes = useProbeStore((s) => s.setProbes);
  const selectProbe = useProbeStore((s) => s.selectProbe);
  const setSelectedChipName = useProbeStore((s) => s.setSelectedChipName);
  const setConnected = useProbeStore((s) => s.setConnected);
  const setSettings = useProbeStore((s) => s.setSettings);
  const setLoading = useProbeStore((s) => s.setLoading);
  const setError = useProbeStore((s) => s.setError);
  const setAutoDisconnect = useProbeStore((s) => s.setAutoDisconnect);
  const setAutoDisconnectTimeout = useProbeStore((s) => s.setAutoDisconnectTimeout);

  const searchResults = useChipStore((s) => s.searchResults);
  const selectedChip = useChipStore((s) => s.selectedChip);
  const searchQuery = useChipStore((s) => s.searchQuery);
  const setSearchResults = useChipStore((s) => s.setSearchResults);
  const selectChip = useChipStore((s) => s.selectChip);
  const setChipInfo = useChipStore((s) => s.setChipInfo);
  const setSearchQuery = useChipStore((s) => s.setSearchQuery);

  const addLog = useLogStore((state) => state.addLog);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeRequestRef = useRef({ generation: 0 });
  const [detecting, setDetecting] = useState(false);

  // 折叠状态
  const [interfaceSettingsOpen, setInterfaceSettingsOpen] = useState(false);
  const [autoDisconnectOpen, setAutoDisconnectOpen] = useState(false);

  const refreshProbes = useCallback(async () => {
    const request = ++probeRequestRef.current.generation;
    try {
      setDetecting(true);
      const probeList = await listProbes();
      if (request !== probeRequestRef.current.generation) return;

      setProbes(probeList);
      setError(null);

      const current = useProbeStore.getState().selectedProbe;
      // 保持已选序列号，并更新运行库提示；设备移除后不保留失效的选择。
      const next = probeList.find((probe) => probe.probe_id === current?.probe_id) ?? probeList[0] ?? null;
      selectProbe(next);
      addLog("info", `检测到 ${probeList.length} 个探针`);
    } catch (error) {
      if (request !== probeRequestRef.current.generation) return;
      setError(String(error));
      addLog("error", `探针检测失败: ${error}`);
    } finally {
      if (request === probeRequestRef.current.generation) setDetecting(false);
    }
  }, [setProbes, selectProbe, setError, addLog]);

  useEffect(() => {
    const requests = probeRequestRef.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void refreshProbes();
    const unlisten = listen("usb-device-changed", () => {
      if (disposed) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refreshProbes(), 300);
    }).catch((error) => {
      addLog("warn", `无法监听探针插拔，请使用刷新按钮：${error}`);
      return () => {};
    });
    return () => {
      disposed = true;
      ++requests.generation;
      clearTimeout(timer);
      void unlisten.then((stop) => stop());
    };
  }, [refreshProbes, addLog]);

  useEffect(
    () => () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    },
    []
  );

  const handleConnect = async () => {
    if (!selectedProbe || !selectedChip) {
      addLog("error", "请先选择探针和目标芯片");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      addLog("info", `正在连接 ${selectedChip}...`);

      const targetInfo = await connectTarget({
        probe_identifier: selectedProbe.probe_id,
        target: selectedChip,
        interface_type: settings.interfaceType === "SWD" ? "Swd" : "Jtag",
        clock_speed: settings.clockSpeed,
        connect_mode: settings.connectMode === "Normal" ? "Normal" : "UnderReset",
      });

      // 从后端获取完整的连接信息
      const status = await getConnectionStatus();

      setConnected(true, status.info, targetInfo);

      addLog("success", `已连接到 ${selectedChip}`);
    } catch (error) {
      setError(String(error));
      addLog("error", `连接失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      setConnected(false);
      addLog("info", "已断开连接");
    } catch (error) {
      addLog("error", `断开连接失败: ${error}`);
    }
  };

  const handleChipSearch = (query: string) => {
    setSearchQuery(query);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchChips(query);
        setSearchResults(results);
      } catch (error) {
        addLog("error", `芯片搜索失败: ${error}`);
      }
    }, 300);
  };

  const handleChipSelect = async (chipName: string) => {
    selectChip(chipName);
    setSearchQuery(chipName);
    setSearchResults([]);
    setSelectedChipName(chipName); // 同步到 probeStore

    try {
      const info = await getChipInfo(chipName);
      setChipInfo(info);
      addLog("info", `已选择芯片: ${chipName}`);
    } catch (error) {
      addLog("error", `获取芯片信息失败: ${error}`);
    }
  };

  // 连接按钮不可用时直接告诉用户还缺哪一步，而不是只给一个灰按钮
  const missingRequirement = !selectedProbe
    ? probes.length === 0
      ? "未检测到探针，插入后将自动识别"
      : "请先选择调试探针"
    : !selectedChip
      ? "请先搜索并选择目标芯片"
      : null;

  return (
    <aside className="surface-sidebar flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[32px]">
      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto p-4">
        {/* 探针选择 */}
        <Card>
          <CardHeader className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">调试探针</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  {selectedProbe ? selectedProbe.identifier : `已检测 ${probes.length} 个探针`}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={refreshProbes}
                disabled={loading || detecting}
                aria-label="刷新探针列表"
                title="刷新探针列表"
              >
                <RefreshCw className={`h-3 w-3 ${detecting ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={selectedProbe?.probe_id || ""}
              onValueChange={(value) => {
                const probe = probes.find((p) => p.probe_id === value);
                selectProbe(probe || null);
                setError(null);
              }}
              disabled={connected}
            >
              <SelectTrigger aria-label="调试探针">
                {selectedProbe ? (
                  <div className="flex items-center gap-2 w-full">
                    <span className="truncate flex-1 text-left">{selectedProbe.identifier}</span>
                    {selectedProbe.dap_version && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                        {selectedProbe.dap_version}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">选择探针</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {probes.map((probe) => (
                  <SelectItem key={probe.probe_id} value={probe.probe_id}>
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="truncate">{probe.identifier}</span>
                      {probe.dap_version && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                          {probe.dap_version}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProbe?.connection_hint && !error && (
              <p role="status" className="break-words text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                {selectedProbe.connection_hint}
              </p>
            )}
            {error && (
              <p role="alert" className="break-words text-xs leading-relaxed text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 芯片选择 */}
        <Card>
          <CardHeader className="py-4">
            <CardTitle className="text-sm">目标芯片</CardTitle>
            <CardDescription className="text-xs">
              {selectedChip || "先搜索并锁定目标芯片，再进入 RTT 或烧录工作流。"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Input
                placeholder="搜索芯片型号..."
                value={searchQuery}
                onChange={(e) => handleChipSearch(e.target.value)}
                disabled={connected}
              />
              {searchResults.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-2xl border border-border/70 bg-white/88 shadow-[0_12px_28px_rgba(72,92,140,0.12)] backdrop-blur">
                  {searchResults.map((chip) => (
                    <button
                      key={chip}
                      className="w-full border-b border-border/50 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/60"
                      onClick={() => handleChipSelect(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pack管理 */}
        <PackManager />

        {/* 接口设置 */}
        <Collapsible open={interfaceSettingsOpen} onOpenChange={setInterfaceSettingsOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-4 cursor-pointer hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">接口设置</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {settings.interfaceType} ·{" "}
                      {(settings.clockSpeed / 1000000).toFixed(settings.clockSpeed >= 1000000 ? 0 : 1)} MHz ·{" "}
                      {settings.connectMode}
                    </CardDescription>
                  </div>
                  {interfaceSettingsOpen ? (
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
                  <label className="text-xs text-muted-foreground">接口类型</label>
                  <Select
                    value={settings.interfaceType}
                    onValueChange={(value: "SWD" | "JTAG") => setSettings({ interfaceType: value })}
                    disabled={connected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SWD">SWD</SelectItem>
                      <SelectItem value="JTAG">JTAG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">时钟速度</label>
                  <Select
                    value={String(settings.clockSpeed)}
                    onValueChange={(value) => setSettings({ clockSpeed: parseInt(value) })}
                    disabled={connected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100000">100 kHz</SelectItem>
                      <SelectItem value="500000">500 kHz</SelectItem>
                      <SelectItem value="1000000">1 MHz</SelectItem>
                      <SelectItem value="2000000">2 MHz</SelectItem>
                      <SelectItem value="4000000">4 MHz</SelectItem>
                      <SelectItem value="10000000">10 MHz</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">连接模式</label>
                  <Select
                    value={settings.connectMode}
                    onValueChange={(value: "Normal" | "UnderReset") => setSettings({ connectMode: value })}
                    disabled={connected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Normal">正常</SelectItem>
                      <SelectItem value="UnderReset">复位下连接</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground">复位方式</label>
                  <Select
                    value={settings.resetMode}
                    onValueChange={(value: "Software" | "Hardware") => setSettings({ resetMode: value })}
                    disabled={connected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Software">软件复位</SelectItem>
                      <SelectItem value="Hardware">硬件复位</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* 自动断开设置 */}
        <Collapsible open={autoDisconnectOpen} onOpenChange={setAutoDisconnectOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="py-4 cursor-pointer hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">自动断开</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {autoDisconnect ? `${autoDisconnectTimeout / 1000} 秒无操作自动断开` : "当前关闭"}
                    </CardDescription>
                  </div>
                  {autoDisconnectOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">启用自动断开</label>
                  <Button
                    size="sm"
                    variant={autoDisconnect ? "secondary" : "outline"}
                    onClick={() => setAutoDisconnect(!autoDisconnect)}
                    className="h-7 text-xs"
                  >
                    {autoDisconnect ? "已启用" : "已禁用"}
                  </Button>
                </div>

                {autoDisconnect && (
                  <div>
                    <label className="text-xs text-muted-foreground">超时时间（秒）</label>
                    <Select
                      value={String(autoDisconnectTimeout / 1000)}
                      onValueChange={(value) => setAutoDisconnectTimeout(parseInt(value) * 1000)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 秒</SelectItem>
                        <SelectItem value="10">10 秒</SelectItem>
                        <SelectItem value="30">30 秒</SelectItem>
                        <SelectItem value="60">60 秒</SelectItem>
                        <SelectItem value="120">120 秒</SelectItem>
                        <SelectItem value="300">300 秒</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">无操作超时后自动断开连接（RTT运行时不会断开）</p>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* 连接信息 */}
        {connected && connectionInfo && (
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-sm">连接信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {selectedProbe?.dap_version && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DAP版本:</span>
                  <span>{selectedProbe.dap_version}</span>
                </div>
              )}
              {connectionInfo.probe_serial && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DAP序列号:</span>
                  <span className="font-mono text-[11px]">{connectionInfo.probe_serial}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">目标:</span>
                <span>{connectionInfo.target_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">内核:</span>
                <span>{connectionInfo.core_type}</span>
              </div>
              {connectionInfo.chip_id !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">芯片ID:</span>
                  <span className="font-mono">
                    0x{connectionInfo.chip_id.toString(16).toUpperCase().padStart(8, "0")}
                  </span>
                </div>
              )}
              {connectionInfo.target_idcode !== null && connectionInfo.target_idcode !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DP IDCODE:</span>
                  <span className="font-mono">
                    0x{connectionInfo.target_idcode.toString(16).toUpperCase().padStart(8, "0")}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* 连接按钮固定在底部：展开上方折叠卡片时位置不再跳动（与串口检查器一致） */}
      <div className="inspector-action-bar shrink-0 px-4 pb-4">
        {debugMode && !connected ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            选择探针和芯片后，点击工具栏「连接」附加调试会话
          </p>
        ) : (
          <>
            {!connected && !loading && missingRequirement && (
              <p className="pb-2 text-center text-xs text-muted-foreground">{missingRequirement}</p>
            )}
            <Button
              className={cn(
                "w-full transition-all",
                connected ? "bg-red-500 hover:bg-red-600 text-white" : "bg-primary hover:bg-primary/90",
                loading && "animate-pulse"
              )}
              onClick={connected ? handleDisconnect : handleConnect}
              disabled={loading || (!connected && (!selectedProbe || !selectedChip))}
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {connected ? "断开中..." : "连接中..."}
                </>
              ) : connected ? (
                <>
                  <Unplug className="h-4 w-4 mr-2" />
                  断开连接
                </>
              ) : (
                <>
                  <Plug className="h-4 w-4 mr-2" />
                  连接设备
                </>
              )}
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
