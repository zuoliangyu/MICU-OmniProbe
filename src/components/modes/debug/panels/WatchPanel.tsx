import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/stores/debugStore";
import { debugReadMemory } from "@/lib/debug";

const STORAGE_KEY = "debug_watch_expressions";
const DEFAULT_SIZE = 4;
const MAX_SIZE = 64;

interface WatchExpression {
  id: string;
  expr: string;
}

interface ResolvedAddress {
  address: number;
  size: number;
}

interface WatchValue {
  bytes: number[];
  fetchedAt: number;
}

function loadExpressions(): WatchExpression[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchExpression[];
    return Array.isArray(parsed) ? parsed.filter((p) => p.id && p.expr) : [];
  } catch {
    return [];
  }
}

function saveExpressions(items: WatchExpression[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // 静默
  }
}

function parseHex(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const value = trimmed.startsWith("0x") ? parseInt(trimmed.slice(2), 16) : parseInt(trimmed, 16);
  return Number.isFinite(value) ? value : null;
}

function formatBytesHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function bytesAsU32Le(bytes: number[]): string | null {
  if (bytes.length < 4) return null;
  const v = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  return `0x${v.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function WatchPanel() {
  const symbols = useDebugStore((s) => s.symbols);
  const state = useDebugStore((s) => s.state);

  const [expressions, setExpressions] = useState<WatchExpression[]>(() => loadExpressions());
  const [values, setValues] = useState<Map<string, WatchValue>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // 持久化变更
  useEffect(() => {
    saveExpressions(expressions);
  }, [expressions]);

  /**
   * 把表达式解析成 (address, size)：
   * - "name" / "name:N"     → 符号表查找
   * - "0xADDR" / "0xADDR:N" → 直接地址
   * - 默认 size=4 字节，上限 MAX_SIZE
   */
  const resolveExpression = useCallback(
    (expr: string): ResolvedAddress | { error: string } => {
      const trimmed = expr.trim();
      if (!trimmed) return { error: "空表达式" };

      let body = trimmed;
      let size = DEFAULT_SIZE;
      const colon = trimmed.lastIndexOf(":");
      if (colon > 0) {
        const sizeStr = trimmed.slice(colon + 1).trim();
        const n = parseInt(sizeStr, 10);
        if (Number.isFinite(n) && n > 0) {
          size = Math.min(n, MAX_SIZE);
          body = trimmed.slice(0, colon).trim();
        }
      }

      // 地址形式
      if (/^0x[0-9a-fA-F]+$/.test(body)) {
        const addr = parseHex(body);
        if (addr === null) return { error: `非法地址: ${body}` };
        return { address: addr, size };
      }

      // 符号名
      const sym = symbols.find((s) => s.name === body);
      if (!sym) return { error: `符号未找到: ${body}` };
      // 若用户没显式给 size，且符号自身 size 非零，用其 size（封顶 MAX_SIZE）
      const finalSize = colon > 0 ? size : Math.min(sym.size > 0 ? Number(sym.size) : DEFAULT_SIZE, MAX_SIZE);
      return { address: sym.address, size: finalSize };
    },
    [symbols]
  );

  const fetchOne = useCallback(
    async (item: WatchExpression) => {
      const resolved = resolveExpression(item.expr);
      if ("error" in resolved) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(item.id, resolved.error);
          return next;
        });
        return;
      }
      try {
        const bytes = await debugReadMemory(resolved.address, resolved.size);
        setValues((prev) => {
          const next = new Map(prev);
          next.set(item.id, { bytes, fetchedAt: Date.now() });
          return next;
        });
        setErrors((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Map(prev);
          next.delete(item.id);
          return next;
        });
      } catch (error) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(item.id, String(error));
          return next;
        });
      }
    },
    [resolveExpression]
  );

  const refreshAll = useCallback(async () => {
    if (state !== "halted" || expressions.length === 0) return;
    setBusy(true);
    try {
      // 串行避免轰炸 probe
      for (const item of expressions) {
        await fetchOne(item);
      }
    } finally {
      setBusy(false);
    }
  }, [state, expressions, fetchOne]);

  // halt 时自动刷新；run/detached 时清缓存
  useEffect(() => {
    if (state === "halted") {
      refreshAll();
    } else if (state === "running" || state === "detached") {
      setValues(new Map());
    }
  }, [state, refreshAll]);

  const addExpression = () => {
    const expr = draft.trim();
    if (!expr) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item = { id, expr };
    setExpressions((prev) => [...prev, item]);
    setDraft("");
    if (state === "halted") {
      fetchOne(item);
    }
  };

  const removeExpression = (id: string) => {
    setExpressions((prev) => prev.filter((e) => e.id !== id));
    setValues((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          观察 {expressions.length > 0 && `(${expressions.length})`}
        </span>
        <button
          type="button"
          onClick={refreshAll}
          disabled={busy || state !== "halted" || expressions.length === 0}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          title="刷新全部"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 pb-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="符号名 / 0xADDR / 名字:N"
          className="h-7 flex-1 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") addExpression();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded-full px-3"
          onClick={addExpression}
          disabled={!draft.trim()}
        >
          <Plus className="h-3 w-3" />
          <span className="text-xs">添加</span>
        </Button>
      </div>

      {expressions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          添加表达式：符号名（如 <span className="font-mono">counter</span>）、地址 （
          <span className="font-mono">0x20000010</span>）或带长度 （<span className="font-mono">name:16</span>）
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-2 pb-3 text-xs">
          <table className="w-full">
            <tbody>
              {expressions.map((item) => {
                const value = values.get(item.id);
                const error = errors.get(item.id);
                const u32 = value ? bytesAsU32Le(value.bytes) : null;
                return (
                  <tr key={item.id} className="border-b border-border/30 last:border-b-0">
                    <td className="w-32 px-2 py-1 font-mono" title={item.expr}>
                      <div className="truncate">{item.expr}</div>
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {error ? (
                        <span className="text-red-500" title={error}>
                          {error.length > 40 ? error.slice(0, 40) + "..." : error}
                        </span>
                      ) : value ? (
                        <div>
                          {u32 && <div>{u32}</div>}
                          {value.bytes.length > 4 && (
                            <div className="text-[11px] text-muted-foreground break-all">
                              {formatBytesHex(value.bytes)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="italic text-muted-foreground">
                          {state === "halted" ? "读取中..." : "halt 后读"}
                        </span>
                      )}
                    </td>
                    <td className="w-8 px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeExpression(item.id)}
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
