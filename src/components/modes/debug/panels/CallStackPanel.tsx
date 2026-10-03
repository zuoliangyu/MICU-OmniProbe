import { useDebugStore } from "@/stores/debugStore";
import { cn } from "@/lib/utils";

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function CallStackPanel() {
  const state = useDebugStore((s) => s.state);
  const frames = useDebugStore((s) => s.frames);
  const currentFrameId = useDebugStore((s) => s.currentFrameId);
  const setCurrentFrameId = useDebugStore((s) => s.setCurrentFrameId);

  const halted = state === "halted";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">调用栈</span>
        {frames.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {frames.length} 帧{frames.length <= 2 ? "（基于 LR，深栈展开待阶段 6）" : ""}
          </span>
        )}
      </div>

      {!halted ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {state === "detached" ? "未连接调试会话" : state === "running" ? "运行中，halt 后查看" : "等待 halt"}
        </div>
      ) : frames.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">无栈帧</div>
      ) : (
        <div className="flex-1 overflow-auto px-2 pb-3 text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="w-8 px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">函数</th>
                <th className="px-2 py-1 text-left">位置</th>
                <th className="w-24 px-2 py-1 text-right">PC</th>
              </tr>
            </thead>
            <tbody>
              {frames.map((f) => {
                const active = f.id === currentFrameId;
                const fileShort = f.file ? f.file.split(/[\\/]/).pop() : null;
                return (
                  <tr
                    key={f.id}
                    onClick={() => setCurrentFrameId(f.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/30 last:border-b-0 transition-colors hover:bg-muted/40",
                      active && "bg-primary/10"
                    )}
                  >
                    <td className="px-2 py-1 text-muted-foreground">#{f.id}</td>
                    <td className="px-2 py-1 truncate" title={f.function ?? ""}>
                      {f.function ?? <span className="text-muted-foreground">{"<unknown>"}</span>}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground" title={f.file ?? ""}>
                      {fileShort ? `${fileShort}${f.line ? `:${f.line}` : ""}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{formatHex(f.pc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
