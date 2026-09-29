// 日志视图选区的 id ↔ 下标换算。
// 独立成无依赖的纯函数文件，便于脚本直接测试（viewerCopy 依赖 Tauri 剪贴板插件）。

export interface SelectedRange {
  start: number;
  end: number;
}

export interface ViewerLineId {
  id: number;
}

/** 第一个 id >= target 的下标（lines 按 id 递增）；都小于时返回 lines.length */
function lowerBound(lines: readonly ViewerLineId[], target: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].id < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 把 id 区间 [startId, endId] 换算成当前 lines 里的下标区间。
 * 起点行已被裁剪时从现存的第一行开始；整段都被裁掉或被过滤掉时返回 null。
 */
export function indexRangeFromIds(
  lines: readonly ViewerLineId[],
  startId: number,
  endId: number
): SelectedRange | null {
  const start = lowerBound(lines, startId);
  const end = lowerBound(lines, endId + 1) - 1;
  return start <= end ? { start, end } : null;
}
