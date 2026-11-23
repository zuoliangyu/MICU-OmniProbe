// ANSI 解析与日志着色：四个日志视图共用 parseColoredSegments，这里守住片段切分与样式叠加。
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });

try {
  const { parseAnsiText } = await server.ssrLoadModule("/src/lib/ansiParser.ts");
  const { parseColoredSegments, LOG_LEVEL_COLORS } = await server.ssrLoadModule("/src/lib/coloredSegments.ts");
  const { DEFAULT_PARSER_CONFIG, parseColoredText } = await server.ssrLoadModule("/src/lib/rttColorParser.ts");

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

  // ---- 自定义颜色标记 ----
  const plain = (segments) => segments.map(({ text }) => text).join("");
  const styleOf = (segments, text) => segments.find((segment) => segment.text === text)?.styles;

  // [/] 关闭最近一个标记（颜色设置对话框里的示例写法）
  const shortClose = parseColoredText("[red]错误信息[/] 后续", DEFAULT_PARSER_CONFIG);
  assert.equal(plain(shortClose), "错误信息 后续");
  assert.equal(styleOf(shortClose, "错误信息").color, "#ef4444");
  assert.deepEqual(styleOf(shortClose, " 后续"), {});

  // [/red] 完整写法仍然可用
  const fullClose = parseColoredText("[red]A[/red]B", DEFAULT_PARSER_CONFIG);
  assert.equal(plain(fullClose), "AB");
  assert.deepEqual(styleOf(fullClose, "B"), {});

  // 带连字符的内置背景色标记
  const bgTag = parseColoredText("[bg-red]警告[/bg-red]", DEFAULT_PARSER_CONFIG);
  assert.equal(plain(bgTag), "警告");
  assert.equal(styleOf(bgTag, "警告").backgroundColor, "#ef4444");

  // 嵌套：[/] 只关最近一层；[/name] 回退到同名标记打开之前
  const nested = parseColoredText("[bold]a[red]b[/]c[/bold]d", DEFAULT_PARSER_CONFIG);
  assert.equal(plain(nested), "abcd");
  assert.equal(styleOf(nested, "b").color, "#ef4444");
  assert.equal(styleOf(nested, "c").fontWeight, "bold");
  assert.equal(styleOf(nested, "c").color, undefined);
  assert.deepEqual(styleOf(nested, "d"), {});
  const unwind = parseColoredText("[bold]a[red]b[/bold]c", DEFAULT_PARSER_CONFIG);
  assert.deepEqual(styleOf(unwind, "c"), {}, "[/bold] 应连同其后打开的 red 一起关闭");

  // 未配置的标记名、普通方括号文本原样保留，不能被吞掉
  assert.equal(plain(parseColoredText("[INFO] [12] [/x] 正常", DEFAULT_PARSER_CONFIG)), "[INFO] [12] [/x] 正常");

  // 自定义前缀 / 后缀 / 关闭标记真正生效，且其中的正则特殊字符按字面匹配
  const custom = { ...DEFAULT_PARSER_CONFIG, tagPrefix: "{{", tagSuffix: "}}", closeTag: "|" };
  const customSegments = parseColoredText("{{red}}x{{|}}y{{green}}z{{|green}}w [red]q[/red]", custom);
  assert.equal(plain(customSegments), "xyzw [red]q[/red]");
  assert.equal(styleOf(customSegments, "x").color, "#ef4444");
  assert.deepEqual(styleOf(customSegments, "y"), {});
  assert.equal(styleOf(customSegments, "z").color, "#22c55e");
  const textClose = parseColoredText("<red>x<end>y", {
    ...DEFAULT_PARSER_CONFIG,
    tagPrefix: "<",
    tagSuffix: ">",
    closeTag: "end",
  });
  assert.equal(plain(textClose), "xy");
  assert.deepEqual(styleOf(textClose, "y"), {});

  // 留空的关闭标记回落到默认 "/"
  assert.equal(plain(parseColoredText("[red]x[/]", { ...DEFAULT_PARSER_CONFIG, closeTag: "" })), "x");

  // 自定义标记名可以包含正则特殊字符
  const special = { ...DEFAULT_PARSER_CONFIG, tags: [{ name: "a.b+", color: "#123456" }] };
  const specialSegments = parseColoredText("[a.b+]x[/] [aXbb]", special);
  assert.equal(plain(specialSegments), "x [aXbb]");
  assert.equal(styleOf(specialSegments, "x").color, "#123456");

  console.log("ANSI 解析与日志着色检查通过");
} finally {
  await server.close();
}
