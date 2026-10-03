import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/stores/debugStore";
import { useLogStore } from "@/stores/logStore";
import { debugReadMemory, type ElfSymbol } from "@/lib/debug";

const MAX_VALUE_BYTES = 64; // 单变量最多展示 64 字节

function formatHex(value: number, width = 8): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

function formatBytesAsHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function bytesAsU32Le(bytes: number[]): string | null {
  if (bytes.length < 4) return null;
  const v = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
  return `0x${v.toString(16).toUpperCase().padStart(8, "0")}`;
}

interface VariableValueState {
  bytes: number[];
  fetchedAt: number;
}

export function LocalsPanel() {
  const symbols = useDebugStore((s) => s.symbols);
  const state = useDebugStore((s) => s.state);
  const addLog = useLogStore((s) => s.addLog);

  const variables = useMemo(() => symbols.filter((s) => s.category === "variable" && s.size > 0), [symbols]);

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [values, setValues] = useState<Map<number, VariableValueState>>(new Map());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return variables.filter((v) => (q === "" ? true : v.name.toLowerCase().includes(q)));
  }, [variables, query]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (expanded.has(filtered[index]?.address ?? -1) ? 90 : 24),
    overscan: 8,
  });

  const fetchValue = useCallback(
    async (sym: ElfSymbol) => {
      const size = Math.min(sym.size, MAX_VALUE_BYTES);
      try {
        const bytes = await debugReadMemory(sym.address, size);
        setValues((prev) => {
          const next = new Map(prev);
          next.set(sym.address, { bytes, fetchedAt: Date.now() });
          return next;
        });
      } catch (error) {
        addLog("warn", `读 ${sym.name} 失败: ${error}`);
      }
    },
    [addLog]
  );

  const refreshExpanded = useCallback(async () => {
    if (state !== "halted" || expanded.size === 0) return;
    setBusy(true);
    try {
      const expandedList = variables.filter((v) => expanded.has(v.address));
      // 串行读取，避免短时间内对探针发太多并发请求
      for (const sym of expandedList) {
        await fetchValue(sym);
      }
    } finally {
      setBusy(false);
    }
  }, [state, expanded, variables, fetchValue]);

  // halt 时自动刷新已展开的项；run/detached 时清掉缓存
  useEffect(() => {
    if (state === "halted") {
      refreshExpanded();
    } else if (state === "running" || state === "detached") {
      setValues(new Map());
    }
  }, [state, refreshExpanded]);

  // index 变了重新计算行高
  useEffect(() => {
    rowVirtualizer.measure();
  }, [expanded, rowVirtualizer]);

  const toggleExpand = (sym: ElfSymbol) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym.address)) {
        next.delete(sym.address);
      } else {
        next.add(sym.address);
        if (state === "halted") {
          fetchValue(sym);
        }
      }
      return next;
    });
  };

  const empty = variables.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          全局变量
          <span className="ml-2 normal-case tracking-normal text-[11px] text-muted-foreground/80">
            （DWARF 类型 / 函数局部变量待后续）
          </span>
        </span>
        <button
          type="button"
          onClick={refreshExpanded}
          disabled={busy || state !== "halted" || expanded.size === 0}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          title="刷新已展开变量"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索变量..."
          disabled={empty}
          className="h-7 pl-7 font-mono text-xs"
        />
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          未加载 ELF 或符号表里无全局变量
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">无匹配项</div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto px-2 pb-2 text-xs">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const sym = filtered[vRow.index];
              const isExpanded = expanded.has(sym.address);
              const value = values.get(sym.address);
              return (
                <div
                  key={vRow.key}
                  className="absolute left-0 top-0 w-full border-b border-border/20 px-2"
                  style={{
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  ref={rowVirtualizer.measureElement}
                  data-index={vRow.index}
                >
                  <div className="flex cursor-pointer items-center gap-2 py-1" onClick={() => toggleExpand(sym)}>
                    <ChevronRight
                      className={`h-3 w-3 flex-shrink-0 text-muted-foreground transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                    <span className="flex-1 truncate" title={sym.name}>
                      {sym.name}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatHex(sym.address)} · {sym.size}B
                    </span>
                    {value && !isExpanded && (
                      <span className="font-mono text-[11px] text-foreground">
                        {bytesAsU32Le(value.bytes) ?? formatBytesAsHex(value.bytes.slice(0, 4)) + "..."}
                      </span>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="ml-5 pb-1 font-mono text-[11px] text-muted-foreground">
                      {state !== "halted" ? (
                        <span className="italic">需 halt 后才能读取</span>
                      ) : value ? (
                        <span className="break-all">
                          {formatBytesAsHex(value.bytes)}
                          {sym.size > MAX_VALUE_BYTES && ` ... (前 ${MAX_VALUE_BYTES}/${sym.size} 字节)`}
                        </span>
                      ) : (
                        <span className="italic">读取中...</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
