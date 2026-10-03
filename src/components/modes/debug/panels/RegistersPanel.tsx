import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebugStore } from "@/stores/debugStore";
import { debugReadRegisters, type DebugRegisterValue } from "@/lib/debug";
import { useLogStore } from "@/stores/logStore";

function formatHex(value: number, width = 8): string {
  // Tauri 返回的是 number；32 位寄存器最多 8 位 hex。
  const hex = value.toString(16).toUpperCase();
  return `0x${hex.padStart(width, "0")}`;
}

export function RegistersPanel() {
  const state = useDebugStore((s) => s.state);
  const addLog = useLogStore((s) => s.addLog);
  const [registers, setRegisters] = useState<DebugRegisterValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [staleAt, setStaleAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (state !== "halted") return;
    setLoading(true);
    try {
      const list = await debugReadRegisters();
      setRegisters(list);
      setStaleAt(Date.now());
    } catch (error) {
      addLog("error", `读寄存器失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [state, addLog]);

  // halt 后自动拉一次；run 后清空（避免显示陈旧值）
  useEffect(() => {
    if (state === "halted") {
      refresh();
    } else if (state === "running") {
      setRegisters([]);
      setStaleAt(null);
    } else if (state === "detached") {
      setRegisters([]);
      setStaleAt(null);
    }
  }, [state, refresh]);

  const canRefresh = state === "halted" && !loading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">寄存器</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 rounded-full px-2"
          onClick={refresh}
          disabled={!canRefresh}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          <span className="text-xs">刷新</span>
        </Button>
      </div>

      {state !== "halted" ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {state === "detached" ? "未连接调试会话" : state === "running" ? "运行中，halt 后查看" : "等待 halt"}
        </div>
      ) : registers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {loading ? "读取中..." : "无寄存器数据"}
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-2 pb-3">
          <table className="w-full text-xs">
            <tbody>
              {registers.map((r) => (
                <tr key={r.name} className="border-b border-border/30 last:border-b-0">
                  <td className="w-20 px-2 py-1 text-muted-foreground">{r.name}</td>
                  <td className="px-2 py-1 font-mono text-foreground">{formatHex(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {staleAt && (
            <div className="px-2 pt-2 text-[11px] text-muted-foreground">
              更新于 {new Date(staleAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
