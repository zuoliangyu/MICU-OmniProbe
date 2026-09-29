// src/lib/ansiParser.ts
// ANSI 转义序列解析模块

export const ANSI_COLORS: Record<string, string> = {
  "30": "text-gray-900 dark:text-gray-300",
  "31": "text-red-500",
  "32": "text-green-500",
  "33": "text-yellow-500",
  "34": "text-blue-500",
  "35": "text-purple-500",
  "36": "text-cyan-500",
  "37": "text-gray-100",
  "90": "text-gray-500",
  "91": "text-red-400",
  "92": "text-green-400",
  "93": "text-yellow-400",
  "94": "text-blue-400",
  "95": "text-purple-400",
  "96": "text-cyan-400",
  "97": "text-white",
};

export const ANSI_BG_COLORS: Record<string, string> = {
  "40": "bg-gray-900",
  "41": "bg-red-500",
  "42": "bg-green-500",
  "43": "bg-yellow-500",
  "44": "bg-blue-500",
  "45": "bg-purple-500",
  "46": "bg-cyan-500",
  "47": "bg-gray-100",
};

export interface TextSegment {
  text: string;
  className: string;
}

function replaceClasses(className: string, pattern: RegExp): string {
  return className.replace(pattern, "").replace(/\s+/g, " ").trim();
}

/** 解析 ANSI 转义序列为样式化文本段 */
export function parseAnsiText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentClass = "";
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), className: currentClass });
    }
    const codes = match[1].split(";");
    for (const code of codes) {
      if (code === "0" || code === "") {
        currentClass = "";
      } else if (code === "1") {
        currentClass = `${currentClass} font-bold`.trim();
      } else if (ANSI_COLORS[code]) {
        // 连同 dark: 变体一起去掉，否则切换颜色后会残留孤立的 "dark:" 前缀
        currentClass = `${replaceClasses(currentClass, /(?:dark:)?text-\S+/g)} ${ANSI_COLORS[code]}`.trim();
      } else if (ANSI_BG_COLORS[code]) {
        currentClass = `${replaceClasses(currentClass, /(?:dark:)?bg-\S+/g)} ${ANSI_BG_COLORS[code]}`.trim();
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), className: currentClass });
  }

  return segments.length > 0 ? segments : [{ text, className: "" }];
}
