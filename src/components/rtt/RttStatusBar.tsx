import { useRttStore } from "@/stores/rttStore";
import { useRttStats } from "@/hooks/useRttEvents";
import { cn } from "@/lib/utils";
import { formatHexAddress } from "@/lib/rttStart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShallow } from "zustand/react/shallow";

export function RttStatusBar() {
  const { isRunning, isStarting, recovering, rttInfo, isPaused, upChannels, selectedChannel, lineCount } = useRttStore(
    useShallow((state) => ({
      isRunning: state.isRunning,
      isStarting: state.isStarting,
      recovering: state.isRunning && state.phase === "recovering",
      rttInfo: state.rttInfo,
      isPaused: state.isPaused,
      upChannels: state.upChannels,
      selectedChannel: state.selectedChannel,
      lineCount: state.lines.length,
    }))
  );
  const { bytesFormatted } = useRttStats();
  const status = isStarting
    ? { label: "查找控制块...", dot: "bg-blue-500 animate-pulse" }
    : !isRunning
      ? { label: "已停止", dot: "bg-gray-500" }
      : recovering
        ? { label: "重新附加中", dot: "bg-amber-500 animate-pulse" }
        : isPaused
          ? { label: "显示已暂停", dot: "bg-yellow-500" }
          : { label: "运行中", dot: "bg-green-500 animate-pulse" };
  const address = rttInfo?.control_block_address;

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
      {/* 运行状态 */}
      <div className="flex items-center gap-1.5">
        <div className={cn("w-2 h-2 rounded-full", status.dot)} />
        <span>{status.label}</span>
      </div>

      {isRunning && rttInfo && address !== null && address !== undefined && (
        <>
          <div className="w-px h-3 bg-border" />
          <span
            className="font-mono"
            title={`${rttInfo.located_by}；${rttInfo.session_source === "main" ? "使用烧录连接" : "独立 RTT 连接"}`}
          >
            控制块 {formatHexAddress(address)}
          </span>
        </>
      )}

      <div className="w-px h-3 bg-border" />

      {/* 通道信息 */}
      <div className="flex items-center gap-2">
        <span>通道:</span>
        <Select
          value={String(selectedChannel)}
          onValueChange={(value) => useRttStore.getState().selectChannel(Number(value))}
        >
          <SelectTrigger aria-label="RTT 通道" className="h-6 w-auto min-w-[88px] gap-1 rounded-md px-2 py-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="-1" className="text-xs">
              全部
            </SelectItem>
            {upChannels.map((ch) => (
              <SelectItem key={ch.index} value={String(ch.index)} className="text-xs">
                {ch.index}: {ch.name || "(未命名)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1" />

      {/* 统计信息 */}
      <div className="flex items-center gap-4">
        <span>行数: {lineCount.toLocaleString()}</span>
        <span>接收: {bytesFormatted}</span>
      </div>
    </div>
  );
}
