// 日志视图定位：HEX 字节解析与匹配、绕回查找、匹配序号、按时间找最近行、时间输入解析。
import assert from "node:assert/strict";
import {
  createLineMatcher,
  findMatch,
  findNearestByTime,
  matchOrdinal,
  parseHexPattern,
  parseLocateTime,
} from "../src/lib/lineLocate.ts";

assert.deepEqual(parseHexPattern("AA 55 01"), [0xaa, 0x55, 0x01]);
assert.deepEqual(parseHexPattern("0xAA,0x55"), [0xaa, 0x55]);
assert.deepEqual(parseHexPattern("aa55"), [0xaa, 0x55]);
assert.equal(parseHexPattern("A"), null, "奇数个十六进制位非法");
assert.equal(parseHexPattern("zz"), null);
assert.equal(parseHexPattern("  "), null);

const base = new Date(2026, 9, 10, 12, 0, 0, 0).getTime();
const lines = [
  { id: 1, text: "boot ok", timestamp: new Date(base), rawData: [0x62, 0x6f] },
  { id: 2, text: "ERR timeout", timestamp: new Date(base + 100), rawData: [0xaa, 0x55, 0x01] },
  { id: 3, text: "temp=25", timestamp: new Date(base + 250) },
  { id: 4, text: "err again", timestamp: new Date(base + 400), rawData: [0x00, 0xaa, 0x55] },
];

const text = createLineMatcher("err", "text")!;
assert.equal(findMatch(lines, text, 0, 1), 1);
assert.equal(findMatch(lines, text, 2, 1), 3);
assert.equal(findMatch(lines, text, 4, 1), 1, "到末尾后绕回开头");
assert.equal(findMatch(lines, text, 0, -1), 3, "向上查找越过开头绕到末尾");
assert.deepEqual(matchOrdinal(lines, text, 3), { ordinal: 2, total: 2 });
assert.equal(createLineMatcher("", "text"), null);
assert.equal(findMatch(lines, createLineMatcher("nothing", "text")!, 0, 1), -1);

const hex = createLineMatcher("AA 55", "hex")!;
assert.equal(findMatch(lines, hex, 0, 1), 1);
assert.equal(findMatch(lines, hex, 2, 1), 3);
// 没有原始字节的行按文本 UTF-8 编码匹配："temp" = 74 65 6D 70
assert.equal(findMatch(lines, createLineMatcher("74 65 6D 70", "hex")!, 0, 1), 2);
assert.equal(createLineMatcher("xyz", "hex"), null);

assert.equal(findNearestByTime(lines, base + 180), 2);
assert.equal(findNearestByTime(lines, base - 5000), 0);
assert.equal(findNearestByTime(lines, base + 99999), 3);
assert.equal(findNearestByTime([], base), -1);

assert.equal(parseLocateTime("2026-10-10 12:00:00.250", 0), base + 250);
assert.equal(parseLocateTime("2026/10/10T12:00:00.5", 0), base + 500, "毫秒不足三位按小数补齐");
assert.equal(parseLocateTime("12:00:00.1", base + 400), base + 100, "只写时刻时取参考行所在日期");
assert.equal(parseLocateTime("12:00", base + 400), base);
assert.equal(parseLocateTime("not a time", base), null);

console.log("行定位检查通过");
