import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useLogStore } from "@/stores/logStore";
import { cn } from "@/lib/utils";
import { exportLogs } from "@/lib/exporters";
import { useSaveTxtContextMenu } from "@/components/ui/save-txt-context-menu";

const LEVEL_STYLES: Record<string, string> = {
  info: "text-foreground",
  success: "text-green-600",
  warn: "text-yellow-600",
  error: "text-red-500",
};

function formatTime(d: Date): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString();
}

export function OutputPanel() {
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const addLog = useLogStore((s) => s.addLog);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 用 debug / Debug / 断点 等关键字粗筛 debug 相关日志，没匹配就回退到全量
  const debugLogs = useMemo(() => {
    const filtered = logs.filter((l) => /debug|attach|halt|断点|step|reset|elf|寄存器|内存|调试|栈/i.test(l.message));
    return filtered.length > 0 ? filtered : logs;
  }, [logs]);

  const handleExport = useCallback(async () => {
    if (debugLogs.length === 0) {
      addLog("warn", "暂无调试输出可保存");
      return;
    }
    try {
      const path = await exportLogs(debugLogs);
      if (path) addLog("success", `调试输出已保存: ${path}`);
    } catch (error) {
      addLog("error", `保存调试输出失败: ${error}`);
    }
  }, [addLog, debugLogs]);
  const { onContextMenu, contextMenu } = useSaveTxtContextMenu(handleExport);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [debugLogs, autoScroll]);

  return (
    <div className="flex h-full flex-col" onContextMenu={onContextMenu}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          输出 {debugLogs.length > 0 && `(${debugLogs.length})`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3"
            />
            自动滚动
          </label>
          <button
            type="button"
            onClick={clearLogs}
            disabled={logs.length === 0}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-500 disabled:opacity-50"
            title="清空日志"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {debugLogs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">无日志</div>
      ) : (
        <div className="flex-1 overflow-auto px-3 pb-2 font-mono text-[11px]">
          {debugLogs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 py-0.5">
              <span className="text-muted-foreground/70">{formatTime(log.timestamp)}</span>
              <span className={cn("flex-1 break-words", LEVEL_STYLES[log.level] ?? "text-foreground")}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      {contextMenu}
    </div>
  );
}
