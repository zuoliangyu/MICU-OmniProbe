import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/stores/debugStore";
import { debugReadMemory } from "@/lib/debug";
import { useLogStore } from "@/stores/logStore";

const BYTES_PER_ROW = 16;

function parseAddress(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const value = trimmed.startsWith("0x") ? parseInt(trimmed.slice(2), 16) : parseInt(trimmed, 16);
  return Number.isFinite(value) ? value : null;
}

function formatRow(rowAddr: number, bytes: number[]): { addr: string; hex: string; ascii: string } {
  const addr = `0x${rowAddr.toString(16).toUpperCase().padStart(8, "0")}`;
  const hex = bytes
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .concat(Array(BYTES_PER_ROW - bytes.length).fill("  "))
    .join(" ");
  const ascii = bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
  return { addr, hex, ascii };
}

export function MemoryPanel() {
  const attached = useDebugStore((s) => s.state) !== "detached";
  const addLog = useLogStore((s) => s.addLog);

  const [addressInput, setAddressInput] = useState("0x20000000");
  const [lengthInput, setLengthInput] = useState("256");
  const [data, setData] = useState<number[] | null>(null);
  const [baseAddress, setBaseAddress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const addr = parseAddress(addressInput);
    if (addr === null) {
      addLog("error", `地址格式错误: ${addressInput}`);
      return;
    }
    const length = parseInt(lengthInput, 10);
    if (!Number.isFinite(length) || length <= 0) {
      addLog("error", `长度无效: ${lengthInput}`);
      return;
    }
    if (length > 64 * 1024) {
      addLog("error", "面板内单次读取最多 64KB");
      return;
    }
    setLoading(true);
    try {
      const bytes = await debugReadMemory(addr, length);
      setData(bytes);
      setBaseAddress(addr);
    } catch (error) {
      addLog("error", `读内存失败: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [addressInput, lengthInput, addLog]);

  const rows: { addr: string; hex: string; ascii: string }[] = [];
  if (data && baseAddress !== null) {
    for (let offset = 0; offset < data.length; offset += BYTES_PER_ROW) {
      rows.push(formatRow(baseAddress + offset, data.slice(offset, offset + BYTES_PER_ROW)));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">内存</span>
      </div>
      <div className="flex items-center gap-2 px-4 pb-2">
        <Input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="地址 (hex)"
          className="h-7 w-36 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") refresh();
          }}
        />
        <Input
          value={lengthInput}
          onChange={(e) => setLengthInput(e.target.value)}
          placeholder="长度"
          className="h-7 w-20 font-mono text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") refresh();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 rounded-full px-3"
          onClick={refresh}
          disabled={!attached || loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          <span className="text-xs">读取</span>
        </Button>
      </div>

      {!attached ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">未连接调试会话</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {loading ? "读取中..." : "输入地址和长度后点击读取"}
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-2 pb-3 font-mono text-[11px] leading-[1.4]">
          <table className="w-full">
            <tbody>
              {rows.map((row) => (
                <tr key={row.addr} className="border-b border-border/20 last:border-b-0">
                  <td className="px-2 py-0.5 text-muted-foreground">{row.addr}</td>
                  <td className="px-2 py-0.5 whitespace-pre text-foreground">{row.hex}</td>
                  <td className="px-2 py-0.5 whitespace-pre text-muted-foreground">{row.ascii}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
