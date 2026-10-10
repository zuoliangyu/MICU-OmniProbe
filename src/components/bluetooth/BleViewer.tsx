import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBluetoothStore } from "@/stores/bluetoothStore";
import { useLogStore } from "@/stores/logStore";
import { cn } from "@/lib/utils";
import type { BleLine } from "@/lib/bleTypes";
import { LOG_LEVEL_COLORS, parseColoredSegments } from "@/lib/coloredSegments";
import { formatTime } from "@/lib/formatters";
import { exportTextAsTxt } from "@/lib/exporters";
import { formatDataAsHex, formatSerialLineForCopy } from "@/lib/viewerCopy";
import { useSaveTxtContextMenu } from "@/components/ui/save-txt-context-menu";
import { useShallow } from "zustand/react/shallow";
import { lineMatchesQuery } from "@/lib/lineSearch";
import { useLineLocator } from "@/hooks/useLineLocator";
import { LineLocatorBar, LOCATED_LINE_CLASS } from "@/components/ui/line-locator-bar";

export function BleViewer() {
  const { autoScroll, showTimestamp, showDirectionPrefix, running, displayMode, connected, lines, searchQuery } =
    useBluetoothStore(
      useShallow((state) => ({
        autoScroll: state.autoScroll,
        showTimestamp: state.showTimestamp,
        showDirectionPrefix: state.showDirectionPrefix,
        running: state.running,
        displayMode: state.displayMode,
        connected: state.connected,
        lines: state.lines,
        searchQuery: state.searchQuery,
      }))
    );

  const filteredLines = useMemo(() => {
    if (!searchQuery.trim()) return lines;
    // 行文本的小写形式按行对象缓存，避免每批数据重算整个缓冲区
    const q = searchQuery.toLowerCase();
    return lines.filter((line) => lineMatchesQuery(line, q));
  }, [lines, searchQuery]);
  const addLog = useLogStore((state) => state.addLog);

  const handleSave = useCallback(async () => {
    try {
      const content = filteredLines
        .map((line) =>
          formatSerialLineForCopy(
            { ...line, text: displayMode === "hex" ? formatDataAsHex(line.rawData, line.text) : line.text },
            showTimestamp,
            showDirectionPrefix
          )
        )
        .join("\n");
      const path = await exportTextAsTxt(content, "ble");
      if (path) addLog("success", `已保存当前 BLE 窗口 ${filteredLines.length} 行到 ${path}`);
    } catch (error) {
      addLog("error", `保存当前 BLE 窗口失败: ${error}`);
    }
  }, [addLog, displayMode, filteredLines, showDirectionPrefix, showTimestamp]);
  const { onContextMenu, contextMenu } = useSaveTxtContextMenu(handleSave);

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 15,
  });

  const locator = useLineLocator(filteredLines, rowVirtualizer);

  // 定位到某行后暂停跟随，否则新数据一来就被拉回底部
  useEffect(() => {
    if (autoScroll && !locator.pinned && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: "end" });
    }
  }, [filteredLines.length, autoScroll, locator.pinned, rowVirtualizer]);

  const emptyMessage = !connected
    ? "请在右侧配置检查器扫描并连接 BLE 设备"
    : !running
      ? "选择 Notify 特征值并启动订阅以接收数据"
      : "等待数据...";

  if (filteredLines.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-background p-2 font-mono text-xs leading-5"
        onContextMenu={onContextMenu}
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
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className={cn(line.id === locator.locatedId && LOCATED_LINE_CLASS)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <BleLineItem
                  line={line}
                  showTimestamp={showTimestamp}
                  showDirectionPrefix={showDirectionPrefix}
                  displayMode={displayMode}
                />
              </div>
            );
          })}
        </div>
      </div>
      <LineLocatorBar lines={filteredLines} locator={locator} />
      {contextMenu}
    </div>
  );
}

interface BleLineItemProps {
  line: BleLine;
  showTimestamp: boolean;
  showDirectionPrefix: boolean;
  displayMode: "text" | "hex";
}

const BleLineItem = React.memo(function BleLineItem({
  line,
  showTimestamp,
  showDirectionPrefix,
  displayMode,
}: BleLineItemProps) {
  const colorParserConfig = useBluetoothStore((state) => state.colorParserConfig);

  const textSegments = useMemo(
    () => parseColoredSegments(line.text, colorParserConfig),
    [line.text, colorParserConfig]
  );

  return (
    <div className={cn("flex items-baseline gap-2 py-0.5 hover:bg-muted/50", LOG_LEVEL_COLORS[line.level])}>
      {showTimestamp && (
        <span className="shrink-0 select-none font-mono text-muted-foreground">
          [{formatTime(line.timestamp.getTime())}]
        </span>
      )}
      {showDirectionPrefix && (
        <span
          className={cn(
            "shrink-0 select-none font-mono text-xs",
            line.direction === "rx" ? "text-emerald-600" : "text-sky-600"
          )}
        >
          {line.direction === "rx" ? "【RX】" : "【TX】"}
        </span>
      )}
      {displayMode === "hex" ? (
        <span className="whitespace-pre-wrap break-all font-mono">{formatDataAsHex(line.rawData, line.text)}</span>
      ) : (
        <span className="whitespace-pre-wrap break-all">
          {textSegments.map((seg, idx) => (
            <span key={idx} className={seg.className} style={seg.styles}>
              {seg.text}
            </span>
          ))}
        </span>
      )}
    </div>
  );
});
