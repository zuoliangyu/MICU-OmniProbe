import { Eye, EyeOff, Radio, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Channel } from "@/lib/chartTypes";

interface CanNodeEditorProps {
  channels: Channel[];
  onChannelsChange: (channels: Channel[]) => void;
}

export function CanNodeEditor({ channels, onChannelsChange }: CanNodeEditorProps) {
  const groups = new Map<string, Channel[]>();
  for (const channel of channels) {
    if (!channel.can) continue;
    const key = `${channel.can.fd ? "FD" : "CAN"}:${channel.can.extended ? "X" : "S"}:${channel.can.frameId}`;
    groups.set(key, [...(groups.get(key) ?? []), channel]);
  }

  const toggle = (target: Channel) => {
    onChannelsChange(
      channels.map((channel) => (channel === target ? { ...channel, visible: !channel.visible } : channel))
    );
  };

  if (groups.size === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无 CAN 信号节点</div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-[linear-gradient(to_right,hsl(var(--border)/0.25)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.25)_1px,transparent_1px)] bg-[size:20px_20px] p-5">
      <div className="mx-auto grid max-w-5xl gap-5">
        {[...groups.entries()].map(([key, signals]) => {
          const source = signals[0].can!;
          return (
            <section key={key} className="grid grid-cols-[180px_40px_minmax(240px,1fr)] items-center">
              <div className="rounded-[8px] border border-primary/40 bg-background shadow-sm">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs font-medium">
                  <Radio className="h-3.5 w-3.5 text-primary" />
                  CAN {source.fd ? "FD" : "帧"}
                </div>
                <div className="px-3 py-3 font-mono text-sm">
                  {source.extended ? "X:" : "S:"}
                  {source.frameId
                    .toString(16)
                    .toUpperCase()
                    .padStart(source.extended ? 8 : 3, "0")}
                </div>
              </div>
              <div className="h-px bg-primary/60" />
              <div className="grid gap-2">
                {signals.map((signal) => (
                  <div
                    key={signal.key}
                    className="flex min-w-0 items-center gap-2 rounded-[8px] border border-border bg-background px-3 py-2 shadow-sm"
                  >
                    <Waypoints className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{signal.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        bit {signal.can!.startBit} | {signal.can!.bitLength} ·{" "}
                        {signal.can!.byteOrder === "little" ? "Intel" : "Motorola"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => toggle(signal)}
                      title={signal.visible ? "隐藏信号" : "显示信号"}
                    >
                      {signal.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
