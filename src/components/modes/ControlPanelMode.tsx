import { useMemo, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { SerialSidebar } from "@/components/serial/SerialSidebar";
import { SerialControlPanel } from "@/components/serial/SerialControlPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useControlPanelStore } from "@/stores/controlPanelStore";
import { useProbeStore } from "@/stores/probeStore";
import { useRttStore } from "@/stores/rttStore";
import { useSerialStore } from "@/stores/serialStore";
import { useShallow } from "zustand/react/shallow";

const unsupportedSend = async () => {
  throw new Error("RTT 数据源暂不支持发送");
};

export function ControlPanelMode() {
  const source = useControlPanelStore((state) => state.source);
  const setSource = useControlPanelStore((state) => state.setSource);
  const [sourceSettingsOpen, setSourceSettingsOpen] = useState(false);
  const selectedProbe = useProbeStore((state) => state.selectedProbe);
  const serial = useSerialStore(
    useShallow((state) => ({
      activeSourceType: state.activeSourceType,
      localConfig: state.localConfig,
      tcpConfig: state.tcpConfig,
      udpConfig: state.udpConfig,
      sendSettings: state.sendSettings,
    }))
  );
  // 只在 RTT 来源时订阅 RTT：串口来源下 RTT 流不该牵动整个控制面板
  const rtt = useRttStore(
    useShallow((state) =>
      source !== "rtt"
        ? null
        : {
            connected: state.rttConnected,
            running: state.isRunning,
            lines: state.lines,
            autoScroll: state.autoScroll,
            showTimestamp: state.showTimestamp,
            displayMode: state.displayMode,
            searchQuery: state.searchQuery,
            chartData: state.chartData,
            processedChartData: state.processedChartData,
            filterActive: state.filterActive,
            chartConfig: state.chartConfig,
            setViewMode: state.setViewMode,
          }
    )
  );
  const rttData = useMemo(
    () =>
      rtt && {
        connected: rtt.connected,
        running: rtt.running,
        // RttLine 可直接作为 ViewerLine 显示（无方向按 rx），不再逐帧 map 出上万个新对象
        lines: rtt.lines,
        autoScroll: rtt.autoScroll,
        showTimestamp: rtt.showTimestamp,
        timestampFormat: "HH:mm:ss.SSS",
        showDirectionPrefix: false,
        displayMode: rtt.displayMode,
        searchQuery: rtt.searchQuery,
        chartData: rtt.chartData,
        processedChartData: rtt.processedChartData,
        filterActive: rtt.filterActive,
        chartConfig: rtt.chartConfig,
        sendSettings: serial.sendSettings,
      },
    [rtt, serial.sendSettings]
  );
  const serialDescription =
    serial.activeSourceType === "local"
      ? `${serial.localConfig.port || "未选择串口"} · ${serial.localConfig.baud_rate} bps`
      : serial.activeSourceType === "tcp"
        ? `${serial.tcpConfig.host}:${serial.tcpConfig.port}`
        : serial.activeSourceType === "udp"
          ? `${serial.udpConfig.local_host}:${serial.udpConfig.local_port} → ${serial.udpConfig.remote_host}:${serial.udpConfig.remote_port}`
          : "模拟数据";
  const sourceDescription = source === "rtt" ? selectedProbe?.identifier || "未选择探针" : serialDescription;
  return (
    <>
      <div className="surface-strong h-full overflow-hidden rounded-[14px] p-2">
        <SerialControlPanel
          source={source}
          onSourceChange={setSource}
          data={rttData ?? undefined}
          sendPayload={source === "rtt" ? unsupportedSend : undefined}
          canSend={source === "serial"}
          sourceDescription={sourceDescription}
          onOpenSourceSettings={() => setSourceSettingsOpen(true)}
          onOpenChart={rtt ? () => rtt.setViewMode("chart") : undefined}
        />
      </div>

      <Dialog open={sourceSettingsOpen} onOpenChange={setSourceSettingsOpen}>
        <DialogContent className="flex h-[82vh] max-w-[720px] flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4">
            <DialogTitle>{source === "rtt" ? "RTT 来源设置" : "串口来源设置"}</DialogTitle>
            <DialogDescription>修改会直接同步到对应工作台，关闭后控制面板立即使用最新配置。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-2">{source === "rtt" ? <Sidebar /> : <SerialSidebar />}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
