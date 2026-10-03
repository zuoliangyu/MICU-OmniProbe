// RTT 启动参数与数据事件的纯函数，供工具栏、事件监听和检查脚本共用
import type { RttDataBatch, RttScanMode, RttStartOptions } from "./types";

export interface RttStartSettingsInput {
  scanMode: RttScanMode;
  scanAddress: number;
  rangeSize: number;
  elfPath: string;
  pollInterval: number;
  haltOnRead: boolean;
  coreIndex: number;
  recoverTimeoutMs: number;
}

export const RTT_SCAN_MODE_LABELS: Record<RttScanMode, string> = {
  auto: "自动扫描 RAM",
  elf: "ELF 符号",
  exact: "指定地址",
  range: "地址范围",
};

/** 解析 0x 前缀或纯十六进制地址；非法时返回 null */
export function parseHexAddress(text: string): number | null {
  const cleaned = text.trim().replace(/^0x/i, "").replace(/_/g, "");
  if (!/^[0-9a-f]{1,16}$/i.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 16);
  return Number.isSafeInteger(value) ? value : null;
}

export function formatHexAddress(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

/** 把界面设置转换为后端启动参数；设置不完整时返回错误说明 */
export function buildRttStartOptions(
  settings: RttStartSettingsInput,
  coreCount: number
): { options: RttStartOptions } | { error: string } {
  const options: RttStartOptions = {
    scan_mode: settings.scanMode,
    poll_interval: Math.min(1000, Math.max(1, Math.round(settings.pollInterval) || 10)),
    halt_on_read: settings.haltOnRead,
    // 单核芯片忽略残留的核心选择，避免换芯片后启动失败
    core_index: coreCount > 1 ? Math.min(Math.max(0, settings.coreIndex), coreCount - 1) : 0,
    recover_timeout_ms: settings.recoverTimeoutMs,
  };
  switch (settings.scanMode) {
    case "exact":
      options.address = settings.scanAddress;
      break;
    case "range":
      if (settings.rangeSize <= 0) return { error: "扫描范围大小必须大于 0" };
      options.range_start = settings.scanAddress;
      options.range_size = settings.rangeSize;
      break;
    case "elf":
      if (!settings.elfPath.trim()) return { error: "ELF 模式需要先选择固件 ELF / AXF 文件" };
      options.elf_path = settings.elfPath.trim();
      break;
  }
  return { options };
}

/** 解码 base64 数据块；返回与旧事件一致的数字数组，下游分帧与解析无需改动 */
export function decodeRttChunks(batch: RttDataBatch): { channel: number; data: number[] }[] {
  return batch.chunks.map((chunk) => {
    const binary = atob(chunk.data);
    const data = new Array<number>(binary.length);
    for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
    return { channel: chunk.channel, data };
  });
}
