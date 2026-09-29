// src/lib/exporters.ts
// 通用数据导出工具：保存对话框 + 写文件 + 各类数据序列化

import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { LogEntry, RttLine } from "./types";
import type { SerialLine } from "./serialTypes";
import type { ChartConfig, ChartDataPoint } from "./chartTypes";
import type { TelemetrySample } from "./telemetry";
import { DEFAULT_TIMESTAMP_FORMAT, formatTime, formatTimestamp } from "./formatters";

interface DialogFilter {
  name: string;
  extensions: string[];
}

const TEXT_FILTERS: DialogFilter[] = [{ name: "文本文件", extensions: ["txt"] }];
const CSV_FILTERS: DialogFilter[] = [{ name: "CSV", extensions: ["csv"] }];
const JSON_FILTERS: DialogFilter[] = [{ name: "JSON", extensions: ["json"] }];
const PNG_FILTERS: DialogFilter[] = [{ name: "PNG 图片", extensions: ["png"] }];

async function saveTextFile(content: string, defaultName: string, filters: DialogFilter[]): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return null;
  await invoke("write_text_file", { path, content });
  return path;
}

export async function exportTextAsTxt(content: string, prefix = "output"): Promise<string | null> {
  return saveTextFile(content, `${prefix}-${timestampSuffix()}.txt`, TEXT_FILTERS);
}

const SESSION_FILTERS: DialogFilter[] = [{ name: "MICU 会话记录", extensions: ["ekrec"] }];

/** 保存采集会话（NDJSON，见 lib/sessionRecord.ts）。 */
export async function exportSessionFile(content: string, prefix = "session"): Promise<string | null> {
  return saveTextFile(content, `${prefix}-${timestampSuffix()}.ekrec`, SESSION_FILTERS);
}

/** 选择并读取一个会话文件；用户取消时返回 null。 */
export async function importSessionFile(): Promise<{ path: string; content: string } | null> {
  const path = await open({ multiple: false, filters: SESSION_FILTERS });
  if (typeof path !== "string") return null;
  const content = await invoke<string>("read_text_file", { path });
  return { path, content };
}

export async function exportJson(content: string, defaultName: string): Promise<string | null> {
  return saveTextFile(content, defaultName, JSON_FILTERS);
}

async function saveBinaryFile(
  base64Content: string,
  defaultName: string,
  filters: DialogFilter[]
): Promise<string | null> {
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) return null;
  await invoke("write_binary_file", { path, contentBase64: base64Content });
  return path;
}

function timestampSuffix(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ============ 日志面板 ============

export async function exportLogs(logs: LogEntry[]): Promise<string | null> {
  const content = logs
    .map((log) => `[${formatTime(log.timestamp.getTime())}] [${log.level.toUpperCase()}] ${log.message}`)
    .join("\n");
  return saveTextFile(content, `omniprobe-logs-${timestampSuffix()}.txt`, TEXT_FILTERS);
}

// ============ RTT ============

export async function exportRttLinesAsTxt(lines: RttLine[]): Promise<string | null> {
  const content = lines
    .map((line) => `[${formatTime(line.timestamp.getTime())}] [CH${line.channel}] ${line.text}`)
    .join("\n");
  return saveTextFile(content, `rtt-${timestampSuffix()}.txt`, TEXT_FILTERS);
}

export async function exportRttLinesAsCsv(lines: RttLine[]): Promise<string | null> {
  const header = "timestamp,channel,level,text";
  const rows = lines.map((line) =>
    [escapeCsv(line.timestamp.toISOString()), String(line.channel), escapeCsv(line.level), escapeCsv(line.text)].join(
      ","
    )
  );
  const content = [header, ...rows].join("\n");
  return saveTextFile(content, `rtt-${timestampSuffix()}.csv`, CSV_FILTERS);
}

// ============ Serial ============

export async function exportSerialLinesAsTxt(
  lines: SerialLine[],
  timestampFormat = DEFAULT_TIMESTAMP_FORMAT
): Promise<string | null> {
  const content = lines
    .map((line) => {
      const dir = line.direction === "tx" ? ">>" : "<<";
      return `[${formatTimestamp(line.timestamp.getTime(), timestampFormat)}] ${dir} ${line.text}`;
    })
    .join("\n");
  return saveTextFile(content, `serial-${timestampSuffix()}.txt`, TEXT_FILTERS);
}

export async function exportSerialLinesAsCsv(lines: SerialLine[]): Promise<string | null> {
  const header = "timestamp,direction,text";
  const rows = lines.map((line) =>
    [escapeCsv(line.timestamp.toISOString()), line.direction, escapeCsv(line.text)].join(",")
  );
  const content = [header, ...rows].join("\n");
  return saveTextFile(content, `serial-${timestampSuffix()}.csv`, CSV_FILTERS);
}

export async function exportCanFramesAsCsv(samples: TelemetrySample[]): Promise<string | null> {
  const header = "timestamp,id,extended,rtr,fd,brs,dlc,data_length,data,signals";
  const rows = samples.flatMap((sample) => {
    const frame = sample.canFrame;
    if (!frame) return [];
    return [
      [
        escapeCsv(new Date(sample.timestamp).toISOString()),
        `0x${frame.id.toString(16).toUpperCase()}`,
        String(frame.extended),
        String(frame.rtr),
        String(frame.fd),
        String(frame.brs),
        String(frame.dlc),
        String(frame.data.length),
        escapeCsv(frame.data.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ")),
        escapeCsv(JSON.stringify(sample.values)),
      ].join(","),
    ];
  });
  return saveTextFile([header, ...rows].join("\n"), `can-frames-${timestampSuffix()}.csv`, CSV_FILTERS);
}

// ============ Chart ============

export function serializeChartDataAsCsv(
  data: ChartDataPoint[],
  config: ChartConfig,
  comparisonData?: ChartDataPoint[]
): string {
  const channelKeys = config.channels.map((c) => c.key);
  const channelNames = config.channels.map((c) => c.name || c.key);

  const header = comparisonData
    ? ["timestamp", ...channelNames.flatMap((name) => [`${name} (处理后)`, `${name} (原始)`]).map(escapeCsv)].join(",")
    : ["timestamp", ...channelNames.map(escapeCsv)].join(",");
  const rows = data.map((point, index) => {
    const cells = [escapeCsv(new Date(point.timestamp).toISOString())];
    for (const key of channelKeys) {
      const value = point.values[key];
      cells.push(value === undefined || !Number.isFinite(value) ? "" : String(value));
      if (comparisonData) {
        const comparisonValue = comparisonData[index]?.values[key];
        cells.push(comparisonValue === undefined || !Number.isFinite(comparisonValue) ? "" : String(comparisonValue));
      }
    }
    return cells.join(",");
  });

  return [header, ...rows].join("\n");
}

export async function exportChartDataAsCsv(
  data: ChartDataPoint[],
  config: ChartConfig,
  options: { comparisonData?: ChartDataPoint[]; filenamePrefix?: string } = {}
): Promise<string | null> {
  const content = serializeChartDataAsCsv(data, config, options.comparisonData);
  return saveTextFile(content, `${options.filenamePrefix ?? "chart"}-${timestampSuffix()}.csv`, CSV_FILTERS);
}

/**
 * 把 canvas 元素导出为 PNG 文件。
 * 适用于 SignalPlotCanvas 这类 <canvas> 渲染的图表。
 */
export async function exportCanvasAsPng(canvas: HTMLCanvasElement): Promise<string | null> {
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  return saveBinaryFile(base64, `chart-${timestampSuffix()}.png`, PNG_FILTERS);
}

/**
 * 把 SVG 元素 (Recharts 渲染的) 转为 PNG。
 * 通过临时 canvas 绘制 svg blob 实现。
 */
export async function exportSvgAsPng(
  svg: SVGSVGElement,
  width: number,
  height: number,
  backgroundColor = "#ffffff"
): Promise<string | null> {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (err) => reject(err);
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法创建 2D 上下文");
    }
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    return await exportCanvasAsPng(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
