import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/stores/debugStore";
import { cn } from "@/lib/utils";

type Tab = "functions" | "variables";

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function SymbolsPanel() {
  const symbols = useDebugStore((s) => s.symbols);
  const functionCount = useDebugStore((s) => s.symbolFunctionCount);
  const variableCount = useDebugStore((s) => s.symbolVariableCount);
  const loadedElfPath = useDebugStore((s) => s.loadedElfPath);

  const [tab, setTab] = useState<Tab>("functions");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const target = tab === "functions" ? "function" : "variable";
    const q = query.trim().toLowerCase();
    return symbols
      .filter((s) => s.category === target)
      .filter((s) => (q === "" ? true : s.name.toLowerCase().includes(q)));
  }, [symbols, tab, query]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 12,
  });

  const empty = symbols.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">符号</span>
        {loadedElfPath && (
          <span className="truncate font-mono text-[10px] text-muted-foreground" title={loadedElfPath}>
            {loadedElfPath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          type="button"
          onClick={() => setTab("functions")}
          className={cn(
            "flex-1 rounded-full px-2 py-1 text-[11px] transition-colors",
            tab === "functions" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          函数 ({functionCount})
        </button>
        <button
          type="button"
          onClick={() => setTab("variables")}
          className={cn(
            "flex-1 rounded-full px-2 py-1 text-[11px] transition-colors",
            tab === "variables" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          变量 ({variableCount})
        </button>
      </div>

      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索..."
          disabled={empty}
          className="h-7 pl-7 font-mono text-xs"
        />
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          点击工具栏「加载 ELF…」加载固件以查看符号
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">无匹配项</div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto px-2 pb-2">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const sym = filtered[vRow.index];
              return (
                <div
                  key={vRow.key}
                  className="flex items-center gap-2 px-2 text-xs"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <span className="flex-1 truncate" title={sym.name}>
                    {sym.name}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{formatHex(sym.address)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
