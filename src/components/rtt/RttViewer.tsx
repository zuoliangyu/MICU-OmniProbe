import React, { useEffect, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRttStore } from "@/stores/rttStore";
import { useProbeStore } from "@/stores/probeStore";
import { useLogStore } from "@/stores/logStore";
import { cn } from "@/lib/utils";
import type { RttLine } from "@/lib/types";
import { LOG_LEVEL_COLORS, parseColoredSegments } from "@/lib/coloredSegments";
import { formatTime } from "@/lib/formatters";
import { useViewerSelection, formatRttLineForCopy, copyTextToClipboard, formatDataAsHex } from "@/lib/viewerCopy";
import { exportTextAsTxt } from "@/lib/exporters";
import { lineMatchesQuery } from "@/lib/lineSearch";
import { useSaveTxtContextMenu } from "@/components/ui/save-txt-context-menu";
import { useShallow } from "zustand/react/shallow";

export function RttViewer() {
  const {
    lines,
    selectedChannel,
    searchQuery,
    autoScroll,
    showTimestamp,
    isRunning,
    isStarting,
    isPaused,
    rttConnected,
    displayMode,
  } = useRttStore(
    useShallow((state) => ({
      lines: state.lines,
      selectedChannel: state.selectedChannel,
      searchQuery: state.searchQuery,
      autoScroll: state.autoScroll,
      showTimestamp: state.showTimestamp,
      isRunning: state.isRunning,
      isStarting: state.isStarting,
      isPaused: state.isPaused,
      rttConnected: state.rttConnected,
      displayMode: state.displayMode,
    }))
  );
  const mainConnected = useProbeStore((state) => state.connected);
  const addLog = useLogStore((state) => state.addLog);

  // 过滤行
  const filteredLines = useMemo(() => {
    let filtered = lines;

    // 按通道过滤（只作用于上行数据；发送记录始终显示）
    if (selectedChannel >= 0) {
      filtered = filtered.filter((line) => line.direction === "tx" || line.channel === selectedChannel);
    }

    // 按搜索词过滤（行文本的小写形式按行对象缓存，避免每批数据重算整个缓冲区）
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((line) => lineMatchesQuery(line, query));
    }

    return filtered;
  }, [lines, selectedChannel, searchQuery]);

  const { scrollRef, getSelectedRange, isSelectAll, highlight, clearSelection } = useViewerSelection(filteredLines);

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22, // 估算行高（像素）
    overscan: 15, // 额外渲染条数
  });

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" });
    }
  }, [filteredLines.length, autoScroll, rowVirtualizer]);

  // Ctrl+C：按行号区间从数据重建（不受虚拟化卸载影响）
  const handleCopy = useCallback(
    (event: KeyboardEvent) => {
      if (!(event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "c")) return;
      const range = getSelectedRange();
      if (!range) return;
      const slice = filteredLines.slice(range.start, range.end + 1);
      if (slice.length === 0) return;
      event.preventDefault();
      const copied = copyTextToClipboard(
        slice.map((line) => formatRttLineForCopy(line, showTimestamp)).join("\n"),
        isSelectAll() ? "全部" : "选区",
        addLog
      );
      if (copied) clearSelection();
    },
    [clearSelection, getSelectedRange, isSelectAll, filteredLines, showTimestamp, addLog]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleCopy);
    return () => document.removeEventListener("keydown", handleCopy);
  }, [handleCopy]);

  const handleSave = useCallback(async () => {
    try {
      const content = filteredLines
        .map((line) =>
          formatRttLineForCopy(
            { ...line, text: displayMode === "hex" ? formatDataAsHex(line.rawData, line.text) : line.text },
            showTimestamp
          )
        )
        .join("\n");
      const path = await exportTextAsTxt(content, "rtt");
      if (path) addLog("success", `已保存当前窗口 ${filteredLines.length} 行到 ${path}`);
    } catch (error) {
      addLog("error", `保存当前窗口失败: ${error}`);
    }
  }, [addLog, displayMode, filteredLines, showTimestamp]);
  const { onContextMenu, contextMenu } = useSaveTxtContextMenu(handleSave);

  // 空状态
  if (filteredLines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {isStarting
          ? "正在查找 RTT 控制块..."
          : !rttConnected && !mainConnected
            ? "请在右侧配置检查器选择探针和芯片，连接 RTT"
            : isRunning
              ? isPaused
                ? "显示已暂停，点击「继续」查看缓存的数据"
                : "等待数据..."
              : "点击「启动」开始接收 RTT 数据"}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onContextMenu={onContextMenu}
      className={cn(
        "h-full overflow-y-auto font-mono text-xs leading-5 p-2 bg-background outline-none",
        highlight && "select-none" // 跨行/全选时关掉原生选区，只留行级高亮，避免两套高亮打架
      )}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const line = filteredLines[virtualRow.index];
          const selected = !!highlight && virtualRow.index >= highlight.start && virtualRow.index <= highlight.end;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-line-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <RttLineItem line={line} showTimestamp={showTimestamp} displayMode={displayMode} selected={selected} />
            </div>
          );
        })}
      </div>
      {contextMenu}
    </div>
  );
}

interface RttLineItemProps {
  line: RttLine;
  showTimestamp: boolean;
  displayMode: "text" | "hex";
  selected: boolean;
}

const RttLineItem = React.memo(function RttLineItem({ line, showTimestamp, displayMode, selected }: RttLineItemProps) {
  const colorParserConfig = useRttStore((state) => state.colorParserConfig);

  const isTx = line.direction === "tx";

  const textSegments = useMemo(
    () => parseColoredSegments(line.text, colorParserConfig),
    [line.text, colorParserConfig]
  );

  return (
    <div
      className={cn(
        "flex gap-2 py-0.5 hover:bg-muted/50",
        isTx ? "text-blue-500" : LOG_LEVEL_COLORS[line.level],
        selected && "bg-primary/20"
      )}
    >
      {showTimestamp && (
        <span className="text-muted-foreground shrink-0 select-none">[{formatTime(line.timestamp.getTime())}]</span>
      )}
      <span className={cn("shrink-0 select-none", isTx ? "text-blue-500" : "text-muted-foreground")}>
        [{isTx ? `→${line.channel}` : line.channel}]
      </span>
      {displayMode === "hex" ? (
        <span className="whitespace-pre-wrap break-all font-mono">{formatDataAsHex(line.rawData, line.text)}</span>
      ) : (
        <span className="whitespace-pre-wrap break-all">
          {textSegments.map((segment, index) => (
            <span key={index} className={segment.className} style={segment.styles}>
              {segment.text}
            </span>
          ))}
        </span>
      )}
    </div>
  );
});
