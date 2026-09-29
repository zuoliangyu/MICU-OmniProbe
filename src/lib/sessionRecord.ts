// 采集会话录制与回放。
//
// 导出 TXT/CSV/PNG 都是单向的：数据出去了回不来。于是改一次滤波参数就得重新
// 复现一次现象，也没法把一段现象存下来发给别人，或者事后拿同一份原始数据对比
// 不同解析/滤波配置的效果。
//
// 这里录的是**原始字节流 + 当时的解析配置**，而不是解析后的数值。原因是只有
// 原始字节才能重放整条链路（分帧 → 解析 → 滤波 → 展示）；存解析后的结果就只能
// 看，不能重新解析。
//
// 文件格式是 NDJSON（每行一条 JSON），首行是头，其余是数据块：
//   {"schema":"ek.session/v1","source":"serial","createdAt":"...","chartConfig":{...}}
//   {"t":0,"d":"<base64>"}
//   {"t":12,"d":"<base64>","ch":1}
// 选 NDJSON 是为了能流式读取——会话文件可能很大，不能整体 JSON.parse。
// 字节用 base64 而不是数字数组：后者在 JSON 里约 4 倍膨胀，base64 只有约 1.33 倍。

import type { RxFramingSettings } from "./serialTypes";
import type { ChartConfig } from "./chartTypes";

export const SESSION_SCHEMA = "ek.session/v1";

export type SessionSource = "serial" | "rtt" | "bluetooth";

export interface SessionHeader {
  schema: typeof SESSION_SCHEMA;
  source: SessionSource;
  /** ISO 时间串，仅用于展示 */
  createdAt: string;
  /** 录制时的图表解析配置，回放时据此还原 */
  chartConfig: ChartConfig;
  /** 录制时的接收分帧设置；RTT/BLE 目前不可配，故为可选 */
  framing?: RxFramingSettings;
  /** 用户备注，便于事后辨认 */
  note?: string;
}

export interface SessionChunk {
  /** 相对录制起点的毫秒数 */
  t: number;
  /** 原始字节 */
  d: number[];
  /** RTT 通道号；其他来源不带 */
  ch?: number;
}

const BASE64_CHUNK = 0x8000; // 分块编码，避免 String.fromCharCode 参数过多

export function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): number[] {
  const binary = atob(value);
  const bytes = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * 录制器。持有原始字节块，不做任何解析——解析在回放时按当时或新的配置重做。
 *
 * 带字节数上限，避免长时间录制吃光内存；超限后停止追加并置 truncated 标记，
 * 而不是静默丢数据。
 */
export class SessionRecorder {
  private chunks: SessionChunk[] = [];
  /** null 表示尚未开始。不能用 0 代表未开始——那样「从 0 时刻起录」会被误判。 */
  private startedAt: number | null = null;
  private bytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}

  get chunkCount(): number {
    return this.chunks.length;
  }

  get byteCount(): number {
    return this.bytes;
  }

  /** 是否因超出上限而截断 */
  get isTruncated(): boolean {
    return this.truncated;
  }

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  start(timestamp = Date.now()): void {
    this.chunks = [];
    this.startedAt = timestamp;
    this.bytes = 0;
    this.truncated = false;
  }

  record(data: number[], timestamp = Date.now(), channel?: number): void {
    if (data.length === 0) return;
    if (this.bytes + data.length > this.maxBytes) {
      this.truncated = true;
      return;
    }
    // 未调用 start() 就直接录时，以首个数据块作为原点
    if (this.startedAt === null) this.startedAt = timestamp;

    const chunk: SessionChunk = { t: Math.max(0, timestamp - this.startedAt), d: data };
    if (channel !== undefined) chunk.ch = channel;
    this.chunks.push(chunk);
    this.bytes += data.length;
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
    this.truncated = false;
    this.startedAt = null;
  }

  /** 序列化成 NDJSON 文本。 */
  serialize(header: Omit<SessionHeader, "schema" | "createdAt"> & { createdAt?: string }): string {
    const fullHeader: SessionHeader = {
      schema: SESSION_SCHEMA,
      createdAt: header.createdAt ?? new Date(this.startedAt ?? Date.now()).toISOString(),
      source: header.source,
      chartConfig: header.chartConfig,
      ...(header.framing ? { framing: header.framing } : {}),
      ...(header.note ? { note: header.note } : {}),
    };

    const lines = [JSON.stringify(fullHeader)];
    for (const chunk of this.chunks) {
      const record: Record<string, unknown> = { t: chunk.t, d: bytesToBase64(chunk.d) };
      if (chunk.ch !== undefined) record.ch = chunk.ch;
      lines.push(JSON.stringify(record));
    }
    return lines.join("\n");
  }
}

export interface ParsedSession {
  header: SessionHeader;
  chunks: SessionChunk[];
}

function parseHeaderLine(line: string): SessionHeader {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error("会话文件首行不是合法 JSON，可能不是 MICU-OmniProbe 会话文件");
  }
  const header = raw as Partial<SessionHeader>;
  if (header?.schema !== SESSION_SCHEMA) {
    throw new Error(`不支持的会话文件格式：${String(header?.schema ?? "未知")}，期望 ${SESSION_SCHEMA}`);
  }
  if (!header.chartConfig) throw new Error("会话文件缺少解析配置，无法回放");
  return header as SessionHeader;
}

function parseChunkLine(line: string): SessionChunk | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null; // 跳过损坏行，尽量把能读的部分读出来
  }
  const record = raw as { t?: unknown; d?: unknown; ch?: unknown };
  if (typeof record.d !== "string") return null;
  const chunk: SessionChunk = {
    t: typeof record.t === "number" && Number.isFinite(record.t) ? record.t : 0,
    d: base64ToBytes(record.d),
  };
  if (typeof record.ch === "number") chunk.ch = record.ch;
  return chunk;
}

/** 一次性解析（适合中小文件与测试）。 */
export function parseSessionFile(text: string): ParsedSession {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("会话文件为空");

  const header = parseHeaderLine(lines[0]);
  const chunks: SessionChunk[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const chunk = parseChunkLine(lines[index]);
    if (chunk) chunks.push(chunk);
  }
  return { header, chunks };
}

/**
 * 流式读取，避免把大会话文件整体载入内存。
 * 先产出头，随后按批产出数据块。
 */
export async function* streamSessionChunks(
  blob: Blob,
  batchSize = 512
): AsyncGenerator<{ header: SessionHeader } | { chunks: SessionChunk[] }> {
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let header: SessionHeader | null = null;
  let batch: SessionChunk[] = [];

  /** 只在首次解析出头时返回它，之后恒为 null——因此调用方无需额外的"已产出"标记。 */
  const consumeLine = (line: string): SessionHeader | null => {
    if (line.trim().length === 0) return null;
    if (!header) {
      header = parseHeaderLine(line);
      return header;
    }
    const chunk = parseChunkLine(line);
    if (chunk) batch.push(chunk);
    return null;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });

    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      const parsedHeader = consumeLine(line);
      if (parsedHeader) yield { header: parsedHeader };
      if (batch.length >= batchSize) {
        yield { chunks: batch };
        batch = [];
      }
      newlineIndex = pending.indexOf("\n");
    }
  }

  pending += decoder.decode();
  if (pending.trim().length > 0) {
    const parsedHeader = consumeLine(pending);
    if (parsedHeader) yield { header: parsedHeader };
  }

  if (!header) throw new Error("会话文件为空或缺少头部");
  if (batch.length > 0) yield { chunks: batch };
}
