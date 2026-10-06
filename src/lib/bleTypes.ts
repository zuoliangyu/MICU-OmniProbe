// 蓝牙类型定义（含 BLE 与经典 SPP）

import type { SerialLine } from "./serialTypes";

/** 蓝牙工作模式 */
export type BluetoothConnectionMode = "ble" | "spp";

export interface BleDeviceInfo {
  id: string;
  address: string;
  name: string | null;
  rssi: number | null;
  connected: boolean;
}

export interface BleCharacteristicProperties {
  read: boolean;
  write: boolean;
  write_without_response: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface BleCharacteristic {
  uuid: string;
  properties: BleCharacteristicProperties;
}

export interface BleService {
  uuid: string;
  characteristics: BleCharacteristic[];
}

export interface NusAutoConfig {
  service_uuid: string;
  notify_char_uuid: string;
  write_char_uuid: string;
}

export interface BleStats {
  bytes_received: number;
  bytes_sent: number;
}

export interface BleDataChunk {
  data: number[];
  timestamp: number;
}

export interface BleDataEvent {
  chunks: BleDataChunk[];
  direction: "rx" | "tx";
}

export interface BleStatusEvent {
  connected: boolean;
  running: boolean;
  error: string | null;
}

/** 蓝牙日志行（与 SerialLine 同形） */
export type BleLine = SerialLine;

export type BleWriteResponseMode = "auto" | "yes" | "no";

/** 写入方式：auto 交给后端按特征值属性选择。 */
export function withResponseFlag(value: BleWriteResponseMode): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}
