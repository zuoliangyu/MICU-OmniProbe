import type { ChartInputLine } from "./parseChartData";

const TIMESTAMPED_LOG_LINE = /^\[(\d{4})(\d{2})(\d{2})_(\d{2}):(\d{2}):(\d{2}):(\d{3})\](.*)$/;
const LOG_FRAME_PREFIX = /^([^\s:]{1,32}:)/;

export interface ImportedLogLine extends ChartInputLine {
  lineNumber: number;
  rawText: string;
  timestamp: number;
  timestampInferred: boolean;
}

export interface LogLineContext {
  lineNumber: number;
  previousTimestamp: number | null;
  fallbackTimestamp: number;
}

export type LogLineParser = (rawLine: string, context: LogLineContext) => ImportedLogLine;

export interface LogImportOptions {
  batchSize?: number;
  fallbackTimestamp?: number;
  maxLineLength?: number;
  parseLine?: LogLineParser;
}

/** 提取行首短前缀，如 P:、@PLOT:；普通文本返回 null。 */
export function detectLogFramePrefix(text: string): string | null {
  return text.match(LOG_FRAME_PREFIX)?.[1] ?? null;
}

function parseLocalTimestamp(match: RegExpMatchArray): number | null {
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const values = [year, month, day, hour, minute, second, millisecond].map(Number);
  const timestamp = new Date(values[0], values[1] - 1, values[2], values[3], values[4], values[5], values[6]).getTime();
  const date = new Date(timestamp);
  return date.getFullYear() === values[0] &&
    date.getMonth() === values[1] - 1 &&
    date.getDate() === values[2] &&
    date.getHours() === values[3] &&
    date.getMinutes() === values[4] &&
    date.getSeconds() === values[5] &&
    date.getMilliseconds() === values[6]
    ? timestamp
    : null;
}

/** 解析样本格式：[yyyyMMdd_HH:mm:ss:fff]消息。坏行保留并继承上一行时间。 */
function parseTimestampedLogLine(rawLine: string, context: LogLineContext): ImportedLogLine {
  const match = rawLine.match(TIMESTAMPED_LOG_LINE);
  const parsedTimestamp = match ? parseLocalTimestamp(match) : null;
  const timestamp = parsedTimestamp ?? context.previousTimestamp ?? context.fallbackTimestamp;

  return {
    lineNumber: context.lineNumber,
    rawText: rawLine,
    text: parsedTimestamp === null ? rawLine : (match?.[8] ?? ""),
    timestamp,
    timestampInferred: parsedTimestamp === null,
  };
}

/** 使用浏览器原生 Blob 流分批读取日志，避免把大文件整体加载到内存。 */
export async function* streamLogLines(blob: Blob, options: LogImportOptions = {}): AsyncGenerator<ImportedLogLine[]> {
  const batchSize = Math.min(10_000, Math.max(1, Math.floor(options.batchSize ?? 2_000)));
  const maxLineLength = Math.max(1_024, options.maxLineLength ?? 1024 * 1024);
  const fallbackTimestamp = options.fallbackTimestamp ?? Date.now();
  const parseLine = options.parseLine ?? parseTimestampedLogLine;
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let pendingText = "";
  let lineNumber = 0;
  let previousTimestamp: number | null = null;
  let batch: ImportedLogLine[] = [];

  const takeLines = (final: boolean): string[] => {
    const lines: string[] = [];
    let start = 0;

    for (let index = 0; index < pendingText.length; index += 1) {
      const character = pendingText[index];
      if (character !== "\n" && character !== "\r") continue;
      if (character === "\r" && index === pendingText.length - 1 && !final) break;

      lines.push(pendingText.slice(start, index));
      if (character === "\r" && pendingText[index + 1] === "\n") index += 1;
      start = index + 1;
    }

    const rest = pendingText.slice(start);
    pendingText = final ? "" : rest;
    if (final && rest) lines.push(rest);
    return lines;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      pendingText += decoder.decode(value, { stream: !done });

      const lines = takeLines(done);
      for (const rawLine of lines) {
        if (rawLine.length > maxLineLength) throw new Error(`日志第 ${lineNumber + 1} 行超过长度限制`);

        lineNumber += 1;
        const parsed = parseLine(rawLine, { lineNumber, previousTimestamp, fallbackTimestamp });
        previousTimestamp = parsed.timestamp;
        batch.push(parsed);

        if (batch.length >= batchSize) {
          yield batch;
          batch = [];
        }
      }

      if (pendingText.length > maxLineLength) throw new Error(`日志第 ${lineNumber + 1} 行超过长度限制`);
      if (done) break;
    }

    if (batch.length > 0) yield batch;
  } finally {
    reader.releaseLock();
  }
}
