// ANSI 解析与日志着色：四个日志视图共用 parseColoredSegments，这里守住片段切分与样式叠加。
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });

try {
  const { parseAnsiText } = await server.ssrLoadModule("/src/lib/ansiParser.ts");
  const { parseColoredSegments, LOG_LEVEL_COLORS } = await server.ssrLoadModule("/src/lib/coloredSegments.ts");
  const { DEFAULT_PARSER_CONFIG } = await server.ssrLoadModule("/src/lib/rttColorParser.ts");

  // 无转义：原样一段
  assert.deepEqual(parseAnsiText("hello"), [{ text: "hello", className: "" }]);
  assert.deepEqual(parseAnsiText(""), [{ text: "", className: "" }]);

  // 颜色、复位
  assert.deepEqual(parseAnsiText("\x1b[31mred\x1b[0m plain"), [
    { text: "red", className: "text-red-500" },
    { text: " plain", className: "" },
  ]);

  // 粗体 + 颜色组合，再换颜色时保留粗体
  const combined = parseAnsiText("\x1b[1;32mok\x1b[33mwarn");
  assert.equal(combined[0].className, "font-bold text-green-500");
  assert.equal(combined[1].className, "font-bold text-yellow-500");

  // 30 带 dark: 变体，切换颜色后不能残留孤立的 "dark:"
  const dark = parseAnsiText("\x1b[30ma\x1b[31mb");
  assert.equal(dark[0].className, "text-gray-900 dark:text-gray-300");
  assert.equal(dark[1].className, "text-red-500");

  // 背景色独立替换
  const bg = parseAnsiText("\x1b[41;37mx\x1b[42my");
  assert.equal(bg[0].className, "bg-red-500 text-gray-100");
  assert.equal(bg[1].className, "text-gray-100 bg-green-500");

  // 着色：未启用自定义标记时只看 ANSI
  const disabled = parseColoredSegments("\x1b[31m[red]x[/red]", { ...DEFAULT_PARSER_CONFIG, enabled: false });
  assert.deepEqual(disabled, [{ text: "[red]x[/red]", className: "text-red-500" }]);

  // 启用时标记被剥掉，ANSI 类名保留在拆出的每一段上
  const enabled = parseColoredSegments("\x1b[1mA [red]B[/red] C", DEFAULT_PARSER_CONFIG);
  assert.equal(enabled.map(({ text }) => text).join(""), "A B C");
  assert.ok(enabled.every(({ className }) => className === "font-bold"));
  assert.ok(enabled.some(({ text, styles }) => text === "B" && styles?.color));

  assert.deepEqual(Object.keys(LOG_LEVEL_COLORS).sort(), ["debug", "error", "info", "warn"]);

  console.log("ANSI 解析与日志着色检查通过");
} finally {
  await server.close();
}
