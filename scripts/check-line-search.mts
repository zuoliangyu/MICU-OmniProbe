// 行搜索按对象缓存小写文本：大小写不敏感、空查询全匹配、同一行对象重复查询结果稳定。
import assert from "node:assert/strict";
import { lineMatchesQuery } from "../src/lib/lineSearch.ts";

const line = { text: "Temp=25 OK" };
assert.equal(lineMatchesQuery(line, ""), true);
assert.equal(lineMatchesQuery(line, "temp"), true);
assert.equal(lineMatchesQuery(line, "ok"), true);
assert.equal(lineMatchesQuery(line, "err"), false);
// 走缓存的第二次调用结果一致
assert.equal(lineMatchesQuery(line, "temp=25"), true);
assert.equal(lineMatchesQuery({ text: "" }, "x"), false);

console.log("行搜索检查通过");
