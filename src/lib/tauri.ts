import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ProbeInfo,
  ConnectOptions,
  TargetInfo,
  ConnectionStatus,
  ChipInfo,
  FlashOptions,
  FirmwareFileInfo,
  PackInfo,
  PackScanReport,
  RttConfig,
  RttStartOptions,
  RttWriteOptions,
  RttSourcesExport,
  EraseMode,
  UsbPermissionStatus,
} from "./types";

// 探针命令
export async function listProbes(): Promise<ProbeInfo[]> {
  return await invoke<ProbeInfo[]>("list_probes");
}

export async function connectTarget(options: ConnectOptions): Promise<TargetInfo> {
  return await invoke<TargetInfo>("connect_target", { options });
}

export async function disconnect(): Promise<void> {
  return await invoke("disconnect");
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return await invoke<ConnectionStatus>("get_connection_status");
}

// RTT 独立连接命令
export async function connectRtt(options: ConnectOptions): Promise<TargetInfo> {
  return await invoke<TargetInfo>("connect_rtt", { options });
}

export async function disconnectRtt(): Promise<void> {
  return await invoke("disconnect_rtt");
}

export async function getRttConnectionStatus(): Promise<ConnectionStatus> {
  return await invoke<ConnectionStatus>("get_rtt_connection_status");
}

// Flash命令
export async function flashFirmware(options: FlashOptions): Promise<void> {
  return await invoke("flash_firmware", { options });
}

export async function eraseChip(eraseMode?: EraseMode): Promise<void> {
  return await invoke("erase_chip", { options: eraseMode ? { erase_mode: eraseMode } : null });
}

export async function eraseSector(address: number, size: number): Promise<void> {
  return await invoke("erase_sector", { options: { address, size } });
}

/** address 与 BIN 自定义烧录地址一致；省略时后端从第一块 Flash 起始地址比对。 */
export async function verifyFirmware(filePath: string, address?: number): Promise<boolean> {
  return await invoke<boolean>("verify_firmware", { filePath, address });
}

/** 后端以原始二进制返回（ipc::Response），避免大块数据按 JSON 数字数组序列化。 */
export async function readFlash(address: number, size: number): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_flash", { options: { address, size } }));
}

/** 把背景图加入 asset 协议白名单，必须在 convertFileSrc 之前调用。 */
export async function allowImageAsset(path: string): Promise<void> {
  await invoke("allow_image_asset", { path });
}

/** 写入二进制文件（扩展名受后端白名单限制）。 */
export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  await invoke("write_binary_file", { path, contentBase64: btoa(binary) });
}

export async function getFirmwareInfo(filePath: string): Promise<FirmwareFileInfo> {
  return await invoke<FirmwareFileInfo>("get_firmware_info", { filePath });
}

// RTT命令
export async function startRtt(options: RttStartOptions): Promise<RttConfig> {
  return await invoke<RttConfig>("start_rtt", { options });
}

export async function stopRtt(): Promise<void> {
  return await invoke("stop_rtt");
}

/** 向 RTT 下行通道发送数据，返回入队字节数；轮询线程会在下一轮写入目标 */
export async function writeRtt(options: RttWriteOptions): Promise<number> {
  return await invoke<number>("write_rtt", { options });
}

/** 把内置的 SEGGER RTT 源文件导出到指定目录 */
export async function exportRttSources(dir: string, overwrite: boolean): Promise<RttSourcesExport> {
  return await invoke<RttSourcesExport>("export_rtt_sources", { dir, overwrite });
}

// 配置命令
export async function searchChips(query: string): Promise<string[]> {
  return await invoke<string[]>("search_chips", { query });
}

export async function getChipInfo(chipName: string): Promise<ChipInfo> {
  return await invoke<ChipInfo>("get_chip_info", { chipName });
}

export async function initPacks(): Promise<number> {
  return await invoke<number>("init_packs");
}

export async function importPack(packPath: string): Promise<PackInfo> {
  return await invoke<PackInfo>("import_pack", { packPath });
}

export async function listImportedPacks(): Promise<PackInfo[]> {
  return await invoke<PackInfo[]>("list_imported_packs");
}

export async function deletePack(packName: string): Promise<void> {
  return await invoke("delete_pack", { packName });
}

export async function getPackScanReport(packName: string): Promise<PackScanReport> {
  return await invoke("get_pack_scan_report", { packName });
}

// 串口命令
import type {
  AiBridgeStatus,
  AiTelemetryBatch,
  AiTextBatch,
  SerialConfig,
  SerialFileTransferOptions,
  SerialFileTransferProgress,
  SerialFileTransferResult,
  SerialPortInfo,
} from "./serialTypes";

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  return await invoke<SerialPortInfo[]>("list_serial_ports_cmd");
}

export async function connectSerial(config: SerialConfig): Promise<void> {
  return await invoke("connect_serial", { config });
}

export async function disconnectSerial(): Promise<void> {
  return await invoke("disconnect_serial");
}

export async function writeSerial(data: number[]): Promise<number> {
  return await invoke<number>("write_serial", { data });
}

export async function writeSerialString(text: string, encoding: string, lineEnding: string): Promise<number> {
  return await invoke<number>("write_serial_string", { text, encoding, lineEnding });
}

export async function sendSerialFile(
  options: SerialFileTransferOptions,
  onProgress: (progress: SerialFileTransferProgress) => void
): Promise<SerialFileTransferResult> {
  const channel = new Channel<SerialFileTransferProgress>();
  channel.onmessage = onProgress;
  return await invoke<SerialFileTransferResult>("send_serial_file", { options, onProgress: channel });
}

export async function cancelSerialFileTransfer(): Promise<boolean> {
  return await invoke<boolean>("cancel_serial_file_transfer");
}

export async function startSerial(pollInterval?: number): Promise<void> {
  return await invoke("start_serial", { pollInterval });
}

export async function stopSerial(): Promise<void> {
  return await invoke("stop_serial");
}

export async function clearSerialBuffer(): Promise<void> {
  return await invoke("clear_serial_buffer");
}

export async function startAiBridge(port: number, allowWrite: boolean): Promise<AiBridgeStatus> {
  return await invoke<AiBridgeStatus>("start_ai_bridge", { port, allowWrite });
}

export async function stopAiBridge(): Promise<AiBridgeStatus> {
  return await invoke<AiBridgeStatus>("stop_ai_bridge");
}

export async function getAiBridgeStatus(): Promise<AiBridgeStatus> {
  return await invoke<AiBridgeStatus>("get_ai_bridge_status");
}

export async function setAiBridgeWriteEnabled(allowWrite: boolean): Promise<AiBridgeStatus> {
  return await invoke<AiBridgeStatus>("set_ai_bridge_write_enabled", { allowWrite });
}

export async function publishAiSamples(batch: AiTelemetryBatch): Promise<void> {
  return await invoke("publish_ai_samples", { batch });
}

export async function publishAiTextLines(batch: AiTextBatch): Promise<void> {
  return await invoke("publish_ai_text_lines", { batch });
}

// USB 权限检查命令
export async function checkUsbPermissions(): Promise<UsbPermissionStatus> {
  return await invoke<UsbPermissionStatus>("check_usb_permissions");
}

export async function installUdevRules(): Promise<string> {
  return await invoke<string>("install_udev_rules");
}

export async function getUdevInstallInstructions(): Promise<string> {
  return await invoke<string>("get_udev_install_instructions");
}

// Pack目录管理命令
export async function getPacksDirectory(): Promise<string> {
  return await invoke<string>("get_packs_directory");
}

export async function setCustomPacksDirectory(path: string | null): Promise<void> {
  return await invoke("set_custom_packs_directory", { path });
}

// BLE 蓝牙命令
import type { BleDeviceInfo, BleService, NusAutoConfig } from "./bleTypes";

export async function bleStartScan(timeoutMs?: number): Promise<BleDeviceInfo[]> {
  return await invoke<BleDeviceInfo[]>("ble_start_scan", { timeoutMs });
}

export async function bleStopScan(): Promise<void> {
  return await invoke("ble_stop_scan");
}

export async function bleConnect(deviceId: string): Promise<BleDeviceInfo> {
  return await invoke<BleDeviceInfo>("ble_connect", { deviceId });
}

export async function bleDisconnect(): Promise<void> {
  return await invoke("ble_disconnect");
}

export async function bleListServices(): Promise<BleService[]> {
  return await invoke<BleService[]>("ble_list_services");
}

export async function bleDetectNus(): Promise<NusAutoConfig | null> {
  return await invoke<NusAutoConfig | null>("ble_detect_nus");
}

export async function bleSubscribe(charUuid: string): Promise<void> {
  return await invoke("ble_subscribe", { charUuid });
}

export async function bleUnsubscribe(): Promise<void> {
  return await invoke("ble_unsubscribe");
}

export async function bleWrite(charUuid: string, data: number[], withResponse: boolean | null): Promise<number> {
  return await invoke<number>("ble_write", { charUuid, data, withResponse });
}

export async function bleWriteString(
  charUuid: string,
  text: string,
  encoding: string,
  lineEnding: string,
  withResponse: boolean | null
): Promise<number> {
  return await invoke<number>("ble_write_string", {
    charUuid,
    text,
    encoding,
    lineEnding,
    withResponse,
  });
}
