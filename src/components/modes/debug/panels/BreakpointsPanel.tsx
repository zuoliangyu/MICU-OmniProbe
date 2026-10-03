import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/stores/debugStore";
import { useLogStore } from "@/stores/logStore";
import { debugClearAllBreakpoints, debugClearBreakpoint, debugListBreakpoints, debugSetBreakpoint } from "@/lib/debug";

function parseAddress(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const value = trimmed.startsWith("0x") ? parseInt(trimmed.slice(2), 16) : parseInt(trimmed, 16);
  return Number.isFinite(value) ? value : null;
}

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function BreakpointsPanel() {
  const attached = useDebugStore((s) => s.state) !== "detached";
  const breakpoints = useDebugStore((s) => s.breakpoints);
  const setBreakpoints = useDebugStore((s) => s.setBreakpoints);
  const addLog = useLogStore((s) => s.addLog);

  const [addressInput, setAddressInput] = useState("");
  const [busy, setBusy] = useState(false);

  // attached 时拉一次现有断点（来自后端权威列表）
  useEffect(() => {
    if (!attached) {
      setBreakpoints([]);
      return;
    }
    debugListBreakpoints()
      .then(setBreakpoints)
      .catch((err) => addLog("warn", `读断点列表失败: ${err}`));
  }, [attached, setBreakpoints, addLog]);

  const refreshList = useCallback(async () => {
    try {
      const list = await debugListBreakpoints();
      setBreakpoints(list);
    } catch (error) {
      addLog("warn", `读断点列表失败: ${error}`);
    }
  }, [setBreakpoints, addLog]);

  const handleAdd = useCallback(async () => {
    const addr = parseAddress(addressInput);
    if (addr === null) {
      addLog("error", `地址格式错误: ${addressInput}`);
      return;
    }
    setBusy(true);
    try {
      await debugSetBreakpoint(addr);
      setAddressInput("");
      await refreshList();
    } catch (error) {
      addLog("error", `设置断点失败: ${error}`);
    } finally {
      setBusy(false);
    }
  }, [addressInput, refreshList, addLog]);

  const handleDelete = useCallback(
    async (address: number) => {
      setBusy(true);
      try {
        await debugClearBreakpoint(address);
        await refreshList();
      } catch (error) {
        addLog("error", `清除断点失败: ${error}`);
      } finally {
        setBusy(false);
      }
    },
    [refreshList, addLog]
  );

  const handleClearAll = useCallback(async () => {
    setBusy(true);
    try {
      await debugClearAllBreakpoints();
      await refreshList();
    } catch (error) {
      addLog("error", `清除全部断点失败: ${error}`);
    } finally {
      setBusy(false);
    }
  }, [refreshList, addLog]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          断点 {breakpoints.length > 0 && `(${breakpoints.length})`}
        </span>
        {breakpoints.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 rounded-full px-2 text-[11px]"
            onClick={handleClearAll}
            disabled={!attached || busy}
          >
            清空
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 pb-2">
        <Input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="地址 (hex)，如 0x08001234"
          className="h-7 flex-1 font-mono text-xs"
          disabled={!attached || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded-full px-3"
          onClick={handleAdd}
          disabled={!attached || busy}
        >
          <Plus className="h-3 w-3" />
          <span className="text-xs">添加</span>
        </Button>
      </div>

      {!attached ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">未连接调试会话</div>
      ) : breakpoints.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          暂无断点。在上方输入地址，或在源码视图行号左侧点击设置。
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-2 pb-3 text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="w-8 px-2 py-1 text-left">#</th>
                <th className="px-2 py-1 text-left">地址 / 位置</th>
                <th className="w-16 px-2 py-1 text-right">命中</th>
                <th className="w-8 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {breakpoints.map((bp) => {
                const fileShort = bp.file ? bp.file.split(/[\\/]/).pop() : null;
                return (
                  <tr key={bp.id} className="border-b border-border/30 last:border-b-0">
                    <td className="px-2 py-1 text-muted-foreground">#{bp.id}</td>
                    <td className="px-2 py-1">
                      <div className="font-mono">{formatHex(bp.address)}</div>
                      {fileShort && bp.line && (
                        <div className="text-[11px] text-muted-foreground" title={bp.file ?? ""}>
                          {fileShort}:{bp.line}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">{bp.hit_count}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(bp.address)}
                        disabled={busy}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
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
