import { useCallback, useMemo, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import type { LocatableLine } from "@/lib/lineLocate";
import { indexRangeFromIds } from "@/lib/viewerSelectionRange";

/**
 * 虚拟列表视图的"定位"状态：记下被定位行的 id（缓冲区头部裁剪后下标会前移），
 * 滚动到该行并标记高亮。定位行仍在列表里时 pinned 为真，视图据此暂停自动滚动，
 * 否则新数据一来就被拉回底部。
 */
export function useLineLocator(lines: readonly LocatableLine[], virtualizer: Virtualizer<HTMLDivElement, Element>) {
  const [locatedId, setLocatedId] = useState<number | null>(null);

  const locatedIndex = useMemo(
    () => (locatedId == null ? -1 : (indexRangeFromIds(lines, locatedId, locatedId)?.start ?? -1)),
    [lines, locatedId]
  );

  const locate = useCallback(
    (index: number) => {
      const line = lines[index];
      if (!line) return;
      setLocatedId(line.id);
      virtualizer.scrollToIndex(index, { align: "center" });
    },
    [lines, virtualizer]
  );

  const release = useCallback(() => setLocatedId(null), []);

  // 查找起点：已定位时从定位行出发，否则从可视区第一行出发（"就近"查找）
  const anchorIndex = useCallback(
    () => (locatedIndex >= 0 ? locatedIndex : (virtualizer.range?.startIndex ?? 0)),
    [locatedIndex, virtualizer]
  );

  return {
    locatedId: locatedIndex >= 0 ? locatedId : null,
    locatedIndex,
    pinned: locatedIndex >= 0,
    locate,
    release,
    anchorIndex,
  };
}

export type LineLocator = ReturnType<typeof useLineLocator>;
