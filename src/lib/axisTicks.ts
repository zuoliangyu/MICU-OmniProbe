// 坐标轴刻度：步长取 1/2/5 × 10ⁿ，刻度值落在步长整数倍上，避免出现 0.672 这类读不顺的数字。

export function niceTickStep(range: number, targetCount = 5): number {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / Math.max(targetCount, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  return factor * magnitude;
}

/** 返回 [min, max] 区间内的整齐刻度值（升序）。 */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const step = niceTickStep(max - min, targetCount);
  const ticks: number[] = [];
  // 用整数倍计算，避免累加步长带来的浮点漂移
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let index = first; index <= last; index += 1) {
    const value = index * step;
    // 修正 0.1 * 3 = 0.30000000000000004 之类的尾差
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}
