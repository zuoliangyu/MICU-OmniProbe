// 坐标轴刻度：步长为 1/2/5 × 10ⁿ，刻度落在步长整数倍上且不越出区间。
import assert from "node:assert/strict";
import { niceTickStep, niceTicks } from "../src/lib/axisTicks.ts";

assert.equal(niceTickStep(10, 5), 2);
assert.equal(niceTickStep(1, 5), 0.2);
assert.equal(niceTickStep(0.9, 5), 0.2);
assert.equal(niceTickStep(24, 5), 5);
assert.equal(niceTickStep(70, 5), 10);
assert.equal(niceTickStep(0, 5), 1);

assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
assert.deepEqual(niceTicks(-0.672, 0.672), [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]);
assert.deepEqual(niceTicks(0.1, 0.35), [0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
assert.deepEqual(niceTicks(1, 1), []);

for (const [min, max] of [
  [-3.7, 12.9],
  [1e-4, 9e-4],
  [1000, 98000],
]) {
  const ticks = niceTicks(min, max);
  assert.ok(ticks.length >= 3 && ticks.length <= 11, `${min}..${max} 刻度数 ${ticks.length}`);
  assert.ok(ticks.every((value) => value >= min && value <= max));
}

console.log("坐标轴刻度检查通过");
