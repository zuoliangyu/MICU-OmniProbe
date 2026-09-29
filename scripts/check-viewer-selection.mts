// 日志视图选区按行 id 记录。缓冲区满后头部被裁剪、下标整体前移，
// 按下标记录的选区会滑到别的行上——这里守住 id → 下标换算不漂移。
import assert from "node:assert/strict";
import { indexRangeFromIds } from "../src/lib/viewerSelectionRange.ts";

const makeLines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i }));

// 选中 id 5..7（此时下标 4..6）
let lines = makeLines(1, 10);
assert.deepEqual(indexRangeFromIds(lines, 5, 7), { start: 4, end: 6 });

// 缓冲区上限 10，又进来 3 行：头部裁掉 id 1..3，同一选区应落在下标 1..3
lines = makeLines(4, 13);
assert.deepEqual(indexRangeFromIds(lines, 5, 7), { start: 1, end: 3 });
assert.deepEqual(
  lines.slice(1, 4).map(({ id }) => id),
  [5, 6, 7],
  "换算后的下标区间必须仍是原来选中的那几行"
);

// 起点已被裁掉：从现存第一行开始
lines = makeLines(6, 15);
assert.deepEqual(indexRangeFromIds(lines, 5, 7), { start: 0, end: 1 });

// 整段都被裁掉
lines = makeLines(20, 29);
assert.equal(indexRangeFromIds(lines, 5, 7), null);

// 过滤后 id 不连续：选区只覆盖仍可见的行
const filtered = [{ id: 2 }, { id: 5 }, { id: 9 }, { id: 12 }];
assert.deepEqual(indexRangeFromIds(filtered, 4, 10), { start: 1, end: 2 });
assert.equal(indexRangeFromIds(filtered, 6, 8), null);

// 空列表
assert.equal(indexRangeFromIds([], 1, 1), null);

console.log("日志视图选区检查通过");
