// 经典蓝牙 SPP 工具：把系统串口列表过滤出蓝牙虚拟 COM 端口
//
// SPP 设备配对后，操作系统会把它映射成虚拟串口（Windows: COMx，
// Linux: /dev/rfcommx，macOS: /dev/tty.*）。本模块仅做识别和过滤，
// 真正的数据通道由现有「串口模式」承担。

import type { SerialPortInfo } from "./serialTypes";

const SPP_KEYWORDS = ["bluetooth", "蓝牙", "rfcomm", "spp"];

function lowerSafe(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/** 判断给定串口是否疑似蓝牙 SPP 端口 */
function isBluetoothSppPort(port: SerialPortInfo): boolean {
  if (port.port_type === "Bluetooth") return true;

  const haystack = `${lowerSafe(port.description)} ${lowerSafe(port.manufacturer)} ${lowerSafe(port.name)}`;
  return SPP_KEYWORDS.some((kw) => haystack.includes(kw));
}

/** 从串口列表里过滤出蓝牙 SPP 端口 */
export function filterBluetoothSppPorts(ports: SerialPortInfo[]): SerialPortInfo[] {
  return ports.filter(isBluetoothSppPort);
}
