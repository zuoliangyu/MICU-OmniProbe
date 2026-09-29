// 日志行着色：ANSI 转义 + 用户自定义颜色标记叠加。
// RTT / 串口 / 蓝牙 / 终端四个视图此前各写一份，这里收成一处。
import type { CSSProperties } from "react";
import { parseAnsiText } from "./ansiParser";
import { parseColoredText, type ColorParserConfig } from "./rttColorParser";

export interface ColoredSegment {
  text: string;
  className?: string;
  styles?: CSSProperties;
}

/** 日志级别对应的文字颜色；模块级常量，避免每行每次渲染都新建 */
export const LOG_LEVEL_COLORS: Record<"info" | "warn" | "error" | "debug", string> = {
  error: "text-red-500",
  warn: "text-yellow-500",
  debug: "text-blue-400",
  info: "text-foreground",
};

/** 先解析 ANSI 片段；启用自定义标记时再在每个片段内解析，合并 ANSI 的 className 与标记的 styles */
export function parseColoredSegments(text: string, colorParserConfig: ColorParserConfig): ColoredSegment[] {
  const ansiSegments = parseAnsiText(text);
  if (!colorParserConfig.enabled) {
    return ansiSegments.map((segment) => ({ text: segment.text, className: segment.className }));
  }

  const result: ColoredSegment[] = [];
  for (const ansiSegment of ansiSegments) {
    for (const customSegment of parseColoredText(ansiSegment.text, colorParserConfig)) {
      result.push({ text: customSegment.text, className: ansiSegment.className, styles: customSegment.styles });
    }
  }
  return result;
}
