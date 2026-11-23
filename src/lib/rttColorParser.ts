/**
 * RTT 颜色语义化解析器
 * 支持用户自定义标记语法，如 [red]text[/red] 或 [red]text[/]
 */

export interface ColorTag {
  name: string; // 标记名称，如 "red"
  color?: string; // 文本颜色
  backgroundColor?: string; // 背景色
  fontWeight?: string; // 字体粗细
  fontStyle?: string; // 字体样式
  textDecoration?: string; // 文本装饰
}

export interface ColorParserConfig {
  enabled: boolean; // 是否启用颜色解析
  tagPrefix: string; // 标记前缀，默认 "["
  tagSuffix: string; // 标记后缀，默认 "]"
  closeTag: string; // 关闭标记，默认 "/"
  tags: ColorTag[]; // 自定义标记列表
}

// 默认颜色标记配置
export const DEFAULT_COLOR_TAGS: ColorTag[] = [
  // 基础颜色
  { name: "red", color: "#ef4444" },
  { name: "green", color: "#22c55e" },
  { name: "blue", color: "#3b82f6" },
  { name: "yellow", color: "#eab308" },
  { name: "cyan", color: "#06b6d4" },
  { name: "magenta", color: "#d946ef" },
  { name: "white", color: "#f8fafc" },
  { name: "gray", color: "#94a3b8" },
  { name: "black", color: "#0f172a" },

  // 背景色
  { name: "bg-red", backgroundColor: "#ef4444", color: "#ffffff" },
  { name: "bg-green", backgroundColor: "#22c55e", color: "#ffffff" },
  { name: "bg-blue", backgroundColor: "#3b82f6", color: "#ffffff" },
  { name: "bg-yellow", backgroundColor: "#eab308", color: "#000000" },

  // 样式
  { name: "bold", fontWeight: "bold" },
  { name: "italic", fontStyle: "italic" },
  { name: "underline", textDecoration: "underline" },

  // 语义化标记
  { name: "error", color: "#ef4444", fontWeight: "bold" },
  { name: "warn", color: "#eab308" },
  { name: "info", color: "#3b82f6" },
  { name: "success", color: "#22c55e" },
  { name: "debug", color: "#94a3b8" },
];

export const DEFAULT_PARSER_CONFIG: ColorParserConfig = {
  enabled: true,
  tagPrefix: "[",
  tagSuffix: "]",
  closeTag: "/",
  tags: DEFAULT_COLOR_TAGS,
};

// 解析后的文本片段
export interface TextSegment {
  text: string;
  styles: React.CSSProperties;
}

// 转义正则表达式特殊字符，让前缀、后缀、关闭标记和标记名都按字面匹配
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface CompiledColorParser {
  tagMap: Map<string, ColorTag>;
  /** 没有任何可用标记时为 null */
  tagRegex: RegExp | null;
}

// 每行渲染都会调用解析；配置对象来自 store，引用稳定，按引用缓存编译结果
const compiledParsers = new WeakMap<ColorParserConfig, CompiledColorParser>();

function compileColorParser(config: ColorParserConfig): CompiledColorParser {
  const cached = compiledParsers.get(config);
  if (cached) return cached;

  // 前缀、后缀或关闭标记被清空时回落到默认值，否则空前缀会把正文里的单词当成标记
  const prefix = escapeRegex(config.tagPrefix || DEFAULT_PARSER_CONFIG.tagPrefix);
  const suffix = escapeRegex(config.tagSuffix || DEFAULT_PARSER_CONFIG.tagSuffix);
  const close = escapeRegex(config.closeTag || DEFAULT_PARSER_CONFIG.closeTag);

  // 标记名称到样式的映射；空名称无法书写，直接忽略
  const tagMap = new Map<string, ColorTag>();
  config.tags.forEach((tag) => {
    if (tag.name) tagMap.set(tag.name, tag);
  });

  // 标记名按长度倒序参与匹配，保证 bg-red 不会被 red 抢先截断；
  // 标记名本身也转义，因此可以包含连字符等任意字符
  const names = Array.from(tagMap.keys())
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex)
    .join("|");
  // 分组 1：关闭标记里的标记名（可省略）；分组 2：开始标记的标记名
  const tagRegex = names ? new RegExp(`${prefix}(?:${close}(${names})?|(${names}))${suffix}`, "g") : null;

  const compiled = { tagMap, tagRegex };
  compiledParsers.set(config, compiled);
  return compiled;
}

/**
 * 解析带颜色标记的文本
 *
 * 支持三种写法（以默认语法为例）：
 * - `[red]文字` 开始标记，可嵌套
 * - `[/red]` 关闭最近一个同名标记（连同其后打开的标记一起关闭）
 * - `[/]` 关闭最近打开的一个标记
 *
 * 只识别已配置的标记名，`[INFO]`、`[12]` 这类普通方括号文本原样保留。
 * @param text 原始文本
 * @param config 解析配置
 * @returns 解析后的文本片段数组
 */
export function parseColoredText(text: string, config: ColorParserConfig = DEFAULT_PARSER_CONFIG): TextSegment[] {
  if (!config.enabled) {
    return [{ text, styles: {} }];
  }

  const { tagMap, tagRegex } = compileColorParser(config);
  if (!tagRegex) {
    return [{ text, styles: {} }];
  }
  // 正则带 g 标志且被缓存复用，每次从头开始匹配
  tagRegex.lastIndex = 0;

  const segments: TextSegment[] = [];
  let lastIndex = 0;
  let currentStyles: React.CSSProperties = {};
  // 栈中保存每个已打开标记的名称与打开前的样式，关闭时按名称回退
  const styleStack: Array<{ name: string; previous: React.CSSProperties }> = [];

  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const [fullMatch, closingName, openingName] = match;
    const matchIndex = match.index;

    // 添加标记前的文本
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, matchIndex),
        styles: { ...currentStyles },
      });
    }

    const tag = openingName === undefined ? undefined : tagMap.get(openingName);
    if (!tag) {
      // 关闭标记：[/] 关闭最近一个；[/name] 回退到最近一个同名标记打开之前，没有同名标记时忽略
      const targetIndex = closingName
        ? styleStack.map((entry) => entry.name).lastIndexOf(closingName)
        : styleStack.length - 1;
      if (targetIndex >= 0) {
        currentStyles = styleStack[targetIndex].previous;
        styleStack.length = targetIndex;
      }
    } else {
      // 开始标记：保存当前样式到栈，再叠加新样式
      styleStack.push({ name: tag.name, previous: currentStyles });

      const newStyles: React.CSSProperties = { ...currentStyles };
      if (tag.color) newStyles.color = tag.color;
      if (tag.backgroundColor) newStyles.backgroundColor = tag.backgroundColor;
      if (tag.fontWeight) newStyles.fontWeight = tag.fontWeight;
      if (tag.fontStyle) newStyles.fontStyle = tag.fontStyle;
      if (tag.textDecoration) newStyles.textDecoration = tag.textDecoration;

      currentStyles = newStyles;
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText) {
      segments.push({
        text: remainingText,
        styles: { ...currentStyles },
      });
    }
  }

  // 如果没有任何片段，返回原始文本
  if (segments.length === 0) {
    return [{ text, styles: {} }];
  }

  return segments;
}

/**
 * 保存配置到 localStorage
 */
export function saveColorParserConfig(config: ColorParserConfig) {
  localStorage.setItem("rtt-color-parser-config", JSON.stringify(config));
}

/**
 * 从 localStorage 加载配置
 */
export function loadColorParserConfig(): ColorParserConfig {
  try {
    const saved = localStorage.getItem("rtt-color-parser-config");
    if (saved) {
      const config = JSON.parse(saved);
      // 合并默认配置，确保新增字段有默认值
      return {
        ...DEFAULT_PARSER_CONFIG,
        ...config,
        tags: config.tags || DEFAULT_COLOR_TAGS,
      };
    }
  } catch {
    // 静默处理，使用默认值
  }
  return DEFAULT_PARSER_CONFIG;
}
