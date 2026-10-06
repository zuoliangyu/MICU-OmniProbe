import type { ChartConfig } from "@/lib/chartTypes";
import type { TelemetrySample } from "@/lib/telemetry";
import { publishAiSamples, publishAiTextLines } from "@/lib/tauri";

/** 桥接数据来源：三个工作台共用同一个监听端口，消息以 source 区分。 */
export type AiSource = "serial" | "rtt" | "ble";

export type AiWritePermissions = Record<AiSource, boolean>;

export interface AiBridgeStatus {
  running: boolean;
  port: number;
  allowWrite: AiWritePermissions;
  clients: number;
  droppedBatches: number;
}

export interface AiTelemetryChannel {
  key: string;
  name: string;
  unit: string | null;
}

export interface AiTelemetrySample {
  timestamp: number;
  values: Record<string, number>;
}

export interface AiTelemetryBatch {
  source: AiSource;
  sampleRateHz: number;
  channels: AiTelemetryChannel[];
  samples: AiTelemetrySample[];
}

export interface AiTextLine {
  timestamp: number;
  direction: "rx" | "tx";
  text: string;
  truncated: boolean;
  /** RTT 上行通道号 */
  channel?: number;
}

export interface AiTextBatch {
  source: AiSource;
  lines: AiTextLine[];
}

export const DEFAULT_AI_BRIDGE_STATUS: AiBridgeStatus = {
  running: false,
  port: 0,
  allowWrite: { serial: false, rtt: false, ble: false },
  clients: 0,
  droppedBatches: 0,
};

export const AI_SOURCE_LABELS: Record<AiSource, string> = {
  serial: "串口",
  rtt: "RTT",
  ble: "蓝牙",
};

/** 各工作台送入桥接的文本行：与文本区同一批数据。 */
export interface AiBridgeInputLine {
  timestamp: Date;
  text: string;
  direction?: "rx" | "tx";
  channel?: number;
}

const MAX_SAMPLES_PER_BATCH = 2048;
const MAX_TEXT_CHARS = 16 * 1024;
const MAX_TEXT_LINES_PER_BATCH = 256;
const MAX_TEXT_BYTES_PER_BATCH = 256 * 1024;
const textEncoder = new TextEncoder();
const reportedSources = new Set<AiSource>();

/**
 * 把一帧内收到的文本行和解析样本推送给 AI 桥接，按服务端单批上限拆分。
 * 调用方负责只在桥接运行时调用。发布失败只在每个来源首次出错时提示一次。
 */
export function publishToAiBridge(
  source: AiSource,
  lines: AiBridgeInputLine[],
  points: TelemetrySample[],
  chartConfig: ChartConfig
): void {
  const publications: Promise<void>[] = [];

  if (points.length > 0) {
    const channels =
      chartConfig.channels.length > 0
        ? chartConfig.channels.map(({ key, name, unit }) => ({ key, name, unit: unit ?? null }))
        : Object.keys(points[0]?.values ?? {}).map((key) => ({ key, name: key, unit: null }));
    for (let index = 0; index < points.length; index += MAX_SAMPLES_PER_BATCH) {
      publications.push(
        publishAiSamples({
          source,
          sampleRateHz: chartConfig.sampleRateHz,
          channels,
          samples: points.slice(index, index + MAX_SAMPLES_PER_BATCH),
        })
      );
    }
  }

  let textLines: AiTextLine[] = [];
  let textBytes = 0;
  for (const line of lines) {
    const text = line.text.slice(0, MAX_TEXT_CHARS);
    const bytes = textEncoder.encode(text).byteLength;
    if (
      textLines.length > 0 &&
      (textLines.length >= MAX_TEXT_LINES_PER_BATCH || textBytes + bytes > MAX_TEXT_BYTES_PER_BATCH)
    ) {
      publications.push(publishAiTextLines({ source, lines: textLines }));
      textLines = [];
      textBytes = 0;
    }
    textLines.push({
      timestamp: line.timestamp.getTime(),
      direction: line.direction ?? "rx",
      text,
      truncated: line.text.length > MAX_TEXT_CHARS,
      ...(line.channel === undefined ? {} : { channel: line.channel }),
    });
    textBytes += bytes;
  }
  if (textLines.length > 0) {
    publications.push(publishAiTextLines({ source, lines: textLines }));
  }

  if (publications.length === 0) return;
  void Promise.all(publications)
    .then(() => {
      reportedSources.delete(source);
    })
    .catch((error) => {
      if (!reportedSources.has(source)) {
        console.warn(`AI 数据桥接发布失败（${AI_SOURCE_LABELS[source]}）`, error);
        reportedSources.add(source);
      }
    });
}
