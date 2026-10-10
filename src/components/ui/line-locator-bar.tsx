import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "@/lib/formatters";
import {
  createLineMatcher,
  findMatch,
  findNearestByTime,
  matchOrdinal,
  parseLocateTime,
  type LocatableLine,
  type LocateMode,
} from "@/lib/lineLocate";
import type { LineLocator } from "@/hooks/useLineLocator";
import { cn } from "@/lib/utils";

const FULL_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS";

/** 被定位行的高亮，套在虚拟列表的行容器上 */
export const LOCATED_LINE_CLASS = "rounded-sm bg-amber-400/20 ring-1 ring-inset ring-amber-500/60";

interface LineLocatorBarProps {
  lines: readonly LocatableLine[];
  locator: LineLocator;
}

/** 文本视图底部的定位栏：按时间跳到最近的行，按文本 / HEX 字节在匹配行之间跳转，不过滤其他行 */
export function LineLocatorBar({ lines, locator }: LineLocatorBarProps) {
  const [timeInput, setTimeInput] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<LocateMode>("text");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const anchorLine = () => lines[Math.min(locator.anchorIndex(), lines.length - 1)];

  const jumpToTime = () => {
    const reference = anchorLine();
    if (!reference) return;
    const target = parseLocateTime(timeInput, reference.timestamp.getTime());
    if (target === null) {
      setStatus({ text: "时间格式应为 HH:mm:ss.SSS 或 YYYY-MM-DD HH:mm:ss.SSS", error: true });
      return;
    }
    const index = findNearestByTime(lines, target);
    locator.locate(index);
    const diff = lines[index].timestamp.getTime() - target;
    setStatus({ text: diff === 0 ? "已定位到该时间" : `最近一行，偏差 ${diff > 0 ? "+" : ""}${diff} ms` });
  };

  const jumpToMatch = (step: 1 | -1) => {
    const matcher = createLineMatcher(query, mode);
    if (!matcher) {
      if (query.trim()) setStatus({ text: "HEX 格式无效，示例：AA 55 01", error: true });
      return;
    }
    const current = locator.locatedIndex;
    const start = current >= 0 ? current + step : locator.anchorIndex();
    const index = findMatch(lines, matcher, start, step);
    if (index < 0) {
      setStatus({ text: "无匹配", error: true });
      return;
    }
    locator.locate(index);
    const { ordinal, total } = matchOrdinal(lines, matcher, index);
    setStatus({ text: `${ordinal} / ${total}` });
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 bg-muted/30 px-2 py-1 text-xs">
      <div className="flex items-center gap-1">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={timeInput}
          onChange={(event) => setTimeInput(event.target.value)}
          onFocus={(event) => {
            // 预填当前位置的时间并全选：直接输入即整体替换，按方向键则可只改几位数字
            const line = anchorLine();
            if (timeInput || !line) return;
            const input = event.currentTarget;
            setTimeInput(formatTimestamp(line.timestamp.getTime(), FULL_TIME_FORMAT));
            requestAnimationFrame(() => input.select());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") jumpToTime();
          }}
          placeholder="时间 HH:mm:ss.SSS"
          title="支持 HH:mm:ss.SSS（取当前位置所在日期）或 YYYY-MM-DD HH:mm:ss.SSS"
          className="h-7 w-48 px-2 font-mono text-xs"
        />
        <Button size="sm" variant="outline" className="h-7" onClick={jumpToTime} disabled={!timeInput.trim()}>
          跳转
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div role="group" aria-label="查找方式" className="flex items-center rounded-lg border border-border/60 p-0.5">
          {(["text", "hex"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              className="h-6 px-2"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setStatus(null);
              }}
            >
              {value === "text" ? "文本" : "HEX"}
            </Button>
          ))}
        </div>
        <div className="relative min-w-32 max-w-72 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setStatus(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpToMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder={mode === "hex" ? "字节序列，如 AA 55 01" : "查找文本（Enter 下一个）"}
            title="Enter 下一个，Shift+Enter 上一个；从定位行或可视区第一行开始查找"
            className={cn("h-7 pl-7 text-xs", mode === "hex" && "font-mono")}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-0.5 px-2"
          onClick={() => jumpToMatch(-1)}
          disabled={!query.trim()}
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp className="h-3.5 w-3.5" />
          上一个
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-0.5 px-2"
          onClick={() => jumpToMatch(1)}
          disabled={!query.trim()}
          title="下一个 (Enter)"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          下一个
        </Button>
      </div>

      {status && (
        <span className={cn("shrink-0", status.error ? "text-red-500" : "text-muted-foreground")}>{status.text}</span>
      )}
      {locator.pinned && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-0.5 px-2"
          onClick={() => {
            locator.release();
            setStatus(null);
          }}
          title="清除定位标记；开启自动滚动时回到最新数据"
        >
          <X className="h-3.5 w-3.5" />
          取消定位
        </Button>
      )}
    </div>
  );
}
