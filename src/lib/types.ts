// 探针信息
export interface ProbeInfo {
  probe_id: string;
  identifier: string;
  vendor_id: number;
  product_id: number;
  serial_number: string | null;
  probe_type: string;
  dap_version: string | null;
  debug_info: string | null;
  connection_hint?: string | null;
}

// 连接选项
export interface ConnectOptions {
  probe_identifier: string;
  target: string;
  interface_type: "Swd" | "Jtag";
  clock_speed: number | null;
  connect_mode: "Normal" | "UnderReset";
}

// 目标信息
export interface TargetInfo {
  name: string;
  core_type: string;
  memory_regions: MemoryRegion[];
  flash_algorithms: string[];
  chip_id: number | null;
}

// 内存区域
export interface MemoryRegion {
  name: string;
  kind: string;
  address: number;
  size: number;
}

// 连接状态
export interface ConnectionStatus {
  connected: boolean;
  info: ConnectionInfo | null;
}

export interface ConnectionInfo {
  probe_name: string;
  probe_serial: string | null; // DAP探针序列号
  target_name: string;
  core_type: string;
  chip_id: number | null; // 芯片DBGMCU_IDCODE
  target_idcode: number | null; // 目标芯片的真实IDCODE
}

// 芯片信息
export interface ChipInfo {
  name: string;
  vendor: string;
  family: string;
  cores: CoreInfo[];
  memory_regions: MemoryRegionInfo[];
  flash_algorithms: FlashAlgorithmInfo[];
}

export interface CoreInfo {
  name: string;
  core_type: string;
}

export interface MemoryRegionInfo {
  name: string;
  kind: string;
  address: number;
  size: number;
  page_size: number | null;
  sector_size: number | null;
}

export interface FlashAlgorithmInfo {
  name: string;
  default: boolean;
  load_address: number;
  data_section_offset: number;
}

// 擦除模式
export type EraseMode = "ChipErase" | "SectorErase";

// Flash烧录选项
export interface FlashOptions {
  file_path: string;
  verify: boolean;
  skip_erase: boolean;
  reset_after: boolean;
  erase_mode: EraseMode;
  use_custom_address?: boolean; // 仅 BIN 格式：使用自定义烧录地址
  custom_flash_address?: number;
  preverify?: boolean; // 预校验：烧录前检查，跳过已正确的块（加速重复烧录）
}

// Flash进度事件
export interface FlashProgressEvent {
  phase: string;
  progress: number;
  message: string;
}

// 固件文件信息
export interface FirmwareFileInfo {
  path: string;
  size: number;
  modified: number | null; // Unix timestamp in seconds
  exists: boolean;
}

// Pack信息
export interface PackInfo {
  name: string;
  vendor: string;
  version: string;
  description: string;
  device_count: number;
}

// Pack 扫描报告
export interface PackScanReport {
  pack_name: string;
  scan_time: string;
  total_devices: number;
  devices_with_algo: number;
  devices_without_algo: number;
  algorithm_stats: AlgorithmStat[];
  devices: DeviceScanResult[];
}

export interface AlgorithmStat {
  algorithm_name: string;
  device_count: number;
}

export interface DeviceScanResult {
  name: string;
  core: string;
  flash_size: number;
  status: "Success" | "Warning" | "Error";
}

// RTT 扫描模式
export type RttScanMode = "auto" | "exact" | "range";

// RTT 启动选项
export interface RttStartOptions {
  scan_mode: RttScanMode;
  address?: number;
  range_start?: number;
  range_size?: number;
  poll_interval?: number;
  halt_on_read?: boolean; // 是否在读取时暂停目标 (默认 true)
}

// RTT 通道信息
export interface RttChannel {
  index: number;
  name: string;
  buffer_size: number;
}

// RTT 配置响应
export interface RttConfig {
  up_channels: RttChannel[];
  down_channels: RttChannel[];
  control_block_address: number | null;
}

// RTT 数据事件 (从后端接收)
export interface RttDataEvent {
  channel: number;
  data: number[];
  timestamp: number;
}

// RTT 状态事件
export interface RttStatusEvent {
  running: boolean;
  error: string | null;
}

// RTT 显示行
export interface RttLine {
  id: number;
  channel: number;
  timestamp: Date;
  text: string;
  level: "info" | "warn" | "error" | "debug";
  rawData?: number[]; // 新增：原始字节数据
}

// 设备设置
export interface DeviceSettings {
  interfaceType: "SWD" | "JTAG";
  clockSpeed: number;
  connectMode: "Normal" | "UnderReset";
  resetMode: "Software" | "Hardware";
  voltage: number;
}

// 日志条目
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

// USB 设备接口信息
export interface UsbInterfaceInfo {
  interface_number: number;
  class: number;
  subclass: number;
  protocol: number;
  interface_string: string | null;
}

// USB 设备信息
export interface UsbDeviceInfo {
  vendor_id: number;
  product_id: number;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
  bus_number: number;
  device_address: number;
  interfaces: UsbInterfaceInfo[];
}

// USB 权限状态
export interface UsbPermissionStatus {
  has_permission: boolean;
  udev_rules_installed: boolean;
  detected_dap_devices: UsbDeviceInfo[];
  suggestions: string[];
}
