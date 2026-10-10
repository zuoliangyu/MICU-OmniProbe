// 日志视图"定位"：按搜索词 / HEX 字节 / 时间跳到某一行，不过滤其他行。
// 无依赖的纯函数，便于脚本直接测试。只在用户点击时扫描一次，不随每批数据重算。
import { lineMatchesQuery } from "./lineSearch.ts";

export interface LocatableLine {
  id: number;
  text: string;
  timestamp: Date;
  rawData?: number[];
}

export type LocateMode = "text" | "hex";

export type LineMatcher = (line: LocatableLine) => boolean;

const textEncoder = new TextEncoder();

/** 解析 "AA BB"、"aabb"、"0xAA,0xBB" 形式的字节序列；为空或非法时返回 null */
export function parseHexPattern(input: string): number[] | null {
  const compact = input.replace(/0x/gi, "").replace(/[\s,]+/g, "");
  if (!compact || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < compact.length; i += 2) bytes.push(parseInt(compact.slice(i, i + 2), 16));
  return bytes;
}

function containsBytes(haystack: ArrayLike<number>, needle: number[]): boolean {
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** 构造匹配函数；查询为空或 HEX 非法时返回 null */
export function createLineMatcher(query: string, mode: LocateMode): LineMatcher | null {
  if (mode === "hex") {
    const bytes = parseHexPattern(query);
    if (!bytes) return null;
    // 没有原始字节的行（如发送记录）按文本的 UTF-8 编码匹配
    return (line) => containsBytes(line.rawData ?? textEncoder.encode(line.text), bytes);
  }
  const lower = query.toLowerCase();
  if (!lower) return null;
  return (line) => lineMatchesQuery(line, lower);
}

/**
 * 从 start（含）起按 step 方向找下一个匹配行，到头后绕回；没有匹配返回 -1。
 */
export function findMatch(lines: readonly LocatableLine[], matcher: LineMatcher, start: number, step: 1 | -1): number {
  const n = lines.length;
  if (n === 0) return -1;
  const from = ((start % n) + n) % n;
  for (let k = 0; k < n; k++) {
    const index = (from + k * step + n) % n;
    if (matcher(lines[index])) return index;
  }
  return -1;
}

/** 匹配总数，以及 index 是其中第几个（从 1 开始） */
export function matchOrdinal(
  lines: readonly LocatableLine[],
  matcher: LineMatcher,
  index: number
): { ordinal: number; total: number } {
  let ordinal = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!matcher(lines[i])) continue;
    total += 1;
    if (i <= index) ordinal = total;
  }
  return { ordinal, total };
}

/** 时间最接近 targetMs 的行；时间相同取靠前的。日志时间不保证单调，按线性扫描。 */
export function findNearestByTime(lines: readonly LocatableLine[], targetMs: number): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const diff = Math.abs(lines[i].timestamp.getTime() - targetMs);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}

const FULL_TIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const CLOCK_TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const toMs = (fraction?: string) => (fraction ? Number(fraction.padEnd(3, "0")) : 0);

/**
 * 解析本地时间："YYYY-MM-DD HH:mm:ss.SSS"，或只写 "HH:mm:ss.SSS"（日期取自 referenceMs 所在的那天）。
 * 秒和毫秒可省略；无法解析返回 null。
 */
export function parseLocateTime(input: string, referenceMs: number): number | null {
  const value = input.trim();
  const full = FULL_TIME_RE.exec(value);
  if (full) {
    const [, y, mo, d, h, mi, s, ms] = full;
    return new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0), toMs(ms)).getTime();
  }
  const clock = CLOCK_TIME_RE.exec(value);
  if (clock) {
    const [, h, mi, s, ms] = clock;
    const date = new Date(referenceMs);
    date.setHours(+h, +mi, +(s ?? 0), toMs(ms));
    return date.getTime();
  }
  return null;
}
