import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

/** 距底部多少像素以内视为"在底部" */
const BOTTOM_THRESHOLD_PX = 24;

/**
 * 虚拟列表的"跟随最新"：只有停在底部时新数据才把视图拉到底。
 * 用户往上翻（scrollTop 变小且离开底部）即暂停跟随，滚回底部或点「回到最新」恢复。
 * 只认 scrollTop 变小而不是单看离底距离：新数据撑高内容、尚未滚动的那一刻也会"离开底部"，不能误判为用户上翻。
 */
export function useFollowBottom(virtualizer: Virtualizer<HTMLDivElement, Element>, count: number, enabled: boolean) {
  const [following, setFollowing] = useState(true);
  const lastScrollTopRef = useRef(0);

  // 重新开启自动滚动 / 取消定位后回到最新数据
  useEffect(() => {
    if (enabled) setFollowing(true);
  }, [enabled]);

  // 列表清空（清空按钮、过滤无结果）后从头开始跟随
  useEffect(() => {
    if (count === 0) {
      setFollowing(true);
      lastScrollTopRef.current = 0;
    }
  }, [count]);

  useEffect(() => {
    if (enabled && following && count > 0) {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    }
  }, [count, enabled, following, virtualizer]);

  const onScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const top = el.scrollTop;
    if (el.scrollHeight - top - el.clientHeight <= BOTTOM_THRESHOLD_PX) setFollowing(true);
    else if (top < lastScrollTopRef.current) setFollowing(false);
    lastScrollTopRef.current = top;
  }, []);

  const jumpToLatest = useCallback(() => {
    setFollowing(true);
    if (count > 0) virtualizer.scrollToIndex(count - 1, { align: "end" });
  }, [count, virtualizer]);

  return {
    onScroll,
    /** 开着自动滚动但用户翻到了上面：显示「回到最新」 */
    paused: enabled && !following && count > 0,
    jumpToLatest,
  };
}
