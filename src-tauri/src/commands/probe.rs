use crate::commands::config::TARGET_REGISTRY;
use crate::commands::{blocking, SharedSession};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, ConnectMode, ConnectionInfo, InterfaceType};
use probe_rs::{
    architecture::arm::dp::{DpAddress, DpRegisterAddress},
    config::Registry,
    probe::{list::Lister, WireProtocol},
    MemoryInterface, Permissions, Session,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeInfo {
    pub probe_id: String,
    pub identifier: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub probe_type: String,
    pub dap_version: Option<String>,
    pub debug_info: Option<String>, // 诊断信息
    #[serde(default)]
    pub connection_hint: Option<String>,
}

/// USB 设备诊断信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbDeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    pub bus_number: u8,
    pub device_address: u8,
    pub interfaces: Vec<UsbInterfaceInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbInterfaceInfo {
    pub interface_number: u8,
    pub class: u8,
    pub subclass: u8,
    pub protocol: u8,
    pub interface_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetInfo {
    pub name: String,
    pub core_type: String,
    pub memory_regions: Vec<MemoryRegion>,
    pub flash_algorithms: Vec<String>,
    pub chip_id: Option<u32>,
    /// 核心数；多核芯片的 RTT 需要选择控制块所在的核心
    pub core_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRegion {
    pub name: String,
    pub kind: String,
    pub address: u64,
    pub size: u64,
}

#[derive(Debug, Clone)]
struct CmsisDapCaps {
    vendor_id: u16,
    product_id: u16,
    serial_number: Option<String>,
    has_hid: bool,
    has_v2: bool,
    debug_info: String, // 诊断信息
}

fn is_cmsis_dap_str(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("cmsis-dap") || lower.contains("cmsis_dap")
}

fn collect_cmsis_dap_caps() -> Vec<CmsisDapCaps> {
    let mut caps = Vec::new();

    let devices = match nusb::list_devices() {
        Ok(devices) => devices,
        Err(e) => {
            log::warn!("nusb list_devices failed: {}", e);
            return caps;
        }
    };

    for device in devices {
        let vid = device.vendor_id();
        let pid = device.product_id();
        let product_str = device.product_string().unwrap_or("");
        let product_is_cmsis = is_cmsis_dap_str(product_str);

        // 只处理可能是 CMSIS-DAP 的设备
        let dominated_vid = vid == 0xFAED || vid == 0x0D28 || vid == 0xC251 || vid == 0x1366 || vid == 0x0483;
        if !dominated_vid && !product_is_cmsis {
            continue;
        }

        let mut debug_lines = Vec::new();
        debug_lines.push(format!("VID={:#06x} PID={:#06x}", vid, pid));
        debug_lines.push(format!("Product: {:?}", product_str));

        let mut has_hid = false;
        let mut has_v2 = false;

        for iface in device.interfaces() {
            let iface_num = iface.interface_number();
            let iface_class = iface.class();
            let iface_subclass = iface.subclass();
            let iface_protocol = iface.protocol();
            let iface_str = iface.interface_string().unwrap_or("");
            let iface_is_cmsis = is_cmsis_dap_str(iface_str);

            debug_lines.push(format!(
                "Interface {}: class={:#04x} sub={:#04x} proto={:#04x} str={:?}",
                iface_num, iface_class, iface_subclass, iface_protocol, iface_str
            ));

            // HID class = 0x03, Vendor Specific class = 0xFF
            if iface_class == 0x03 && (iface_is_cmsis || product_is_cmsis) {
                debug_lines.push("  -> HID interface (DAPv1)".to_string());
                has_hid = true;
            } else if iface_class == 0xFF && (iface_is_cmsis || product_is_cmsis) {
                debug_lines.push("  -> Vendor Specific (potential DAPv2)".to_string());
                has_v2 = true;
            }
        }

        debug_lines.push(format!("Summary: has_hid={}, has_v2={}", has_hid, has_v2));

        if product_is_cmsis || has_hid || has_v2 {
            caps.push(CmsisDapCaps {
                vendor_id: vid,
                product_id: pid,
                serial_number: device.serial_number().map(|s| s.to_string()).filter(|s| !s.is_empty()),
                has_hid,
                has_v2,
                debug_info: debug_lines.join("\n"),
            });
        }
    }

    caps
}

fn match_caps_for_probe<'a>(
    probe: &probe_rs::probe::DebugProbeInfo,
    caps: &'a [CmsisDapCaps],
) -> Option<&'a CmsisDapCaps> {
    let probe_serial = probe.serial_number.as_deref().filter(|s| !s.is_empty());

    let direct_match = caps.iter().find(|c| {
        if c.vendor_id != probe.vendor_id || c.product_id != probe.product_id {
            return false;
        }
        let cap_serial = c.serial_number.as_deref().filter(|s| !s.is_empty());
        match (probe_serial, cap_serial) {
            (Some(p), Some(c)) => p == c,
            (None, None) => true,
            _ => false,
        }
    });

    if direct_match.is_some() {
        return direct_match;
    }

    if probe_serial.is_none() {
        return caps
            .iter()
            .find(|c| c.vendor_id == probe.vendor_id && c.product_id == probe.product_id);
    }

    None
}

fn build_probe_id(vendor_id: u16, product_id: u16, serial_number: &Option<String>) -> String {
    let serial = serial_number.as_deref().unwrap_or("");
    format!("{:04x}:{:04x}:{}", vendor_id, product_id, serial)
}

/// Try to read the chip IDCODE
/// Different chip families have different IDCODE register addresses
fn read_chip_id(session: &mut Session) -> Option<u32> {
    let mut core = session.core(0).ok()?;

    // Common chip IDCODE address list
    let id_addresses: &[(u64, &str)] = &[
        (0xE0042000, "STM32 DBGMCU_IDCODE"),   // Most STM32 chips
        (0x40015800, "STM32G0/G4 DBG_IDCODE"), // STM32G0/G4 series
        (0x1FFFF7E8, "STM32 UID"),             // Backup: Unique ID
        (0x10000060, "nRF FICR.INFO.PART"),    // Nordic nRF
        (0x40000FF8, "RP2040 CHIPID"),         // Raspberry Pi RP2040
    ];

    for (addr, _name) in id_addresses {
        if let Ok(id) = core.read_word_32(*addr) {
            // Exclude invalid values
            if id != 0 && id != 0xFFFFFFFF {
                return Some(id);
            }
        }
    }

    None
}

/// Try to read the DP IDCODE (DPIDR) from the debug port
/// This identifies the debug access port implementation
fn read_dp_idcode(session: &mut Session) -> Option<u32> {
    // Get ARM interface and read DPIDR
    if let Ok(interface) = session.get_arm_interface() {
        // DPIDR register: address 0x0, no bank selection
        let dp_addr = DpAddress::Default;
        let reg_addr = DpRegisterAddress {
            address: 0x0,
            bank: None,
        };
        if let Ok(dpidr) = interface.read_raw_dp_register(dp_addr, reg_addr) {
            if dpidr != 0 && dpidr != 0xFFFFFFFF {
                return Some(dpidr);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn list_probes() -> AppResult<Vec<ProbeInfo>> {
    blocking(|| Ok(enumerate_probes())).await
}

fn enumerate_probes() -> Vec<ProbeInfo> {
    // 使用 nusb 收集 CMSIS-DAP 能力信息
    let caps = collect_cmsis_dap_caps();
    log::info!("=== CMSIS-DAP Capabilities from nusb ===");
    for cap in &caps {
        log::info!(
            "Device VID={:#06x}, PID={:#06x}, serial={:?}, has_hid={}, has_v2={}",
            cap.vendor_id,
            cap.product_id,
            cap.serial_number,
            cap.has_hid,
            cap.has_v2
        );
    }

    // probe-rs 枚举
    let probes = Lister::new().list_all();
    log::info!("=== Probe enumeration (probe-rs) ===");
    log::info!("Total probes found: {}", probes.len());

    #[allow(unused_mut)]
    let mut probe_infos: Vec<ProbeInfo> = probes
        .iter()
        .map(|p| {
            let probe_type_str = format!("{:?}", p.probe_type());
            log::info!(
                "Probe: identifier={}, VID={:#06x}, PID={:#06x}, serial={:?}, type={}",
                p.identifier,
                p.vendor_id,
                p.product_id,
                p.serial_number,
                probe_type_str
            );

            // 优先用 nusb 能力信息判断 DAP 版本，未匹配时退回 probe_type 名称
            let (probe_type, dap_version, debug_info) = match match_caps_for_probe(p, &caps) {
                Some(cap) => {
                    log::info!("  -> Matched caps: has_hid={}, has_v2={}", cap.has_hid, cap.has_v2);
                    // 同时支持 HID 和 WinUSB 时合并为一个条目（probe-rs 自动选择最优协议）
                    let (probe_type, dap_version) = match (cap.has_hid, cap.has_v2) {
                        (true, true) => ("CmsisDap".to_string(), Some("DAPv1+v2 (HID/WinUSB)")),
                        (false, true) => ("CmsisDapV2".to_string(), Some("DAPv2 (WinUSB)")),
                        (true, false) => ("CmsisDap".to_string(), Some("DAPv1 (HID)")),
                        (false, false) => (probe_type_str, None),
                    };
                    (probe_type, dap_version, Some(cap.debug_info.clone()))
                }
                None => {
                    let upper = probe_type_str.to_uppercase();
                    let dap_version = if !(upper.contains("CMSIS") || upper.contains("DAP")) {
                        None
                    } else if upper.contains("V2") {
                        Some("DAPv2 (WinUSB)")
                    } else {
                        Some("DAPv1 (HID)")
                    };
                    (probe_type_str, dap_version, None)
                }
            };

            ProbeInfo {
                probe_id: build_probe_id(p.vendor_id, p.product_id, &p.serial_number),
                identifier: p.identifier.clone(),
                vendor_id: p.vendor_id,
                product_id: p.product_id,
                serial_number: p.serial_number.clone(),
                probe_type,
                dap_version: dap_version.map(str::to_string),
                debug_info,
                connection_hint: None,
            }
        })
        .collect();

    #[cfg(windows)]
    crate::jlink::augment(&mut probe_infos);

    log::info!("=== Probe enumeration end, total {} entries ===", probe_infos.len());
    probe_infos
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConnectOptions {
    pub probe_identifier: String,
    pub target: String,
    pub interface_type: InterfaceType,
    pub clock_speed: Option<u32>,
    pub connect_mode: ConnectMode,
}

/// 一次成功连接的结果
pub(crate) struct OpenedSession {
    pub session: Session,
    pub target_info: TargetInfo,
    pub connection_info: ConnectionInfo,
}

/// 打开探针并 attach 到目标芯片（烧录、RTT、调试三种独立连接共用）。
/// 同步阻塞，调用方需放在阻塞线程里执行。
pub(crate) fn open_session(options: &ConnectOptions) -> AppResult<OpenedSession> {
    log::info!(
        "连接目标: 探针={} 芯片={} 接口={:?} 时钟={:?}Hz 模式={:?}",
        options.probe_identifier,
        options.target,
        options.interface_type,
        options.clock_speed,
        options.connect_mode
    );

    let probes = enumerate_probes();
    let mut matches = probes
        .iter()
        .filter(|p| p.probe_id == options.probe_identifier || p.identifier == options.probe_identifier);
    let probe_info = matches.next().ok_or_else(|| {
        log::error!("未找到指定的探针: {}", options.probe_identifier);
        AppError::ProbeError("未找到指定的探针".to_string())
    })?;
    if matches.next().is_some() {
        return Err(AppError::ProbeError(
            "有多个同名探针，请刷新列表并按序列号重新选择。".into(),
        ));
    }

    // 查找时持锁，打开设备和 attach 期间不阻塞芯片搜索及 Pack 导入。
    let target = TARGET_REGISTRY
        .lock()
        .get_target_by_name(&options.target)
        .map_err(|e| AppError::ProbeError(format!("无法查找芯片 '{}': {e}", options.target)))?;
    let mut probe = open_selected_probe(
        probe_info,
        options,
        target.cores.iter().all(|core| core.core_type.is_cortex_m()),
    )?;

    let protocol = match options.interface_type {
        InterfaceType::Swd => WireProtocol::Swd,
        InterfaceType::Jtag => WireProtocol::Jtag,
    };
    probe.select_protocol(protocol).map_err(|e| {
        log::error!("设置协议失败 ({:?}): {}", protocol, e);
        AppError::ProbeError(format!("设置协议失败: {}", e))
    })?;

    // 设置时钟速度（前端传递的是Hz，probe-rs需要kHz）
    if let Some(speed_hz) = options.clock_speed {
        let speed_khz = speed_hz / 1000;
        probe.set_speed(speed_khz).map_err(|e| {
            log::error!("设置时钟速度失败 ({} kHz): {}", speed_khz, e);
            AppError::ProbeError(format!("设置时钟速度失败 ({} kHz): {}", speed_khz, e))
        })?;
    }

    let connect_error = |e: &dyn std::fmt::Display| {
        log::error!("连接目标失败 ({:?}): {}", options.connect_mode, e);
        AppError::ProbeError(format!(
            "无法连接到芯片 '{}': {}。请检查: 1) 芯片型号是否正确 2) 是否已导入对应的Pack文件 3) 硬件连接是否正常",
            options.target, e
        ))
    };

    let empty_registry = Registry::new();
    let mut session = if options.connect_mode == ConnectMode::UnderReset {
        probe.attach_under_reset_with_registry(target, Permissions::default(), &empty_registry)
    } else {
        probe.attach_with_registry(target, Permissions::default(), &empty_registry)
    }
    .map_err(|e| connect_error(&e))?;

    log::info!("✓ 成功连接到目标芯片");

    // 读取芯片ID（DBGMCU_IDCODE）与调试端口ID（DPIDR）
    let chip_id = read_chip_id(&mut session);
    let target_idcode = read_dp_idcode(&mut session);
    log::info!("芯片ID: {:08X?}，调试端口ID: {:08X?}", chip_id, target_idcode);

    let target_info = build_target_info(&session, chip_id);
    let connection_info = ConnectionInfo {
        probe_name: probe_info.identifier.clone(),
        probe_serial: probe_info.serial_number.clone(),
        target_name: options.target.clone(),
        core_type: target_info.core_type.clone(),
        chip_id,
        target_idcode,
    };

    Ok(OpenedSession {
        session,
        target_info,
        connection_info,
    })
}

fn open_selected_probe(
    info: &ProbeInfo,
    _options: &ConnectOptions,
    _cortex_m: bool,
) -> AppResult<probe_rs::probe::Probe> {
    #[cfg(windows)]
    if let Some(serial) = crate::jlink::serial_from_id(&info.probe_id) {
        if crate::jlink::runtime_available() && _options.interface_type == InterfaceType::Swd && _cortex_m {
            return crate::jlink::open(serial).map_err(AppError::ProbeError);
        }
    }

    // 已使用 WinUSB 的设备及其他探针继续使用原来的传输路径。
    let raw = Lister::new().list_all().into_iter().find(|probe| {
        build_probe_id(probe.vendor_id, probe.product_id, &probe.serial_number) == info.probe_id
            || (probe.vendor_id == info.vendor_id
                && probe.product_id == info.product_id
                && probe
                    .serial_number
                    .as_deref()
                    .and_then(|s| s.parse::<u32>().ok())
                    .zip(info.serial_number.as_deref().and_then(|s| s.parse::<u32>().ok()))
                    .is_some_and(|(a, b)| a == b))
    });
    let result = raw
        .ok_or_else(|| "探针已断开，请重新插入后重试。".to_string())
        .and_then(|probe| probe.open().map_err(|error| error.to_string()));
    result.map_err(|error| {
        #[cfg(windows)]
        if crate::jlink::serial_from_id(&info.probe_id).is_some() {
            let hint = if crate::jlink::runtime_available() {
                "当前官方驱动接入仅支持 Cortex-M 芯片的 SWD 连接，请检查芯片和接口设置。".into()
            } else {
                crate::jlink::missing_runtime_message()
            };
            log::warn!("J-Link 连接失败: {error}");
            return AppError::ProbeError(hint);
        }
        AppError::ProbeError(format!("打开探针失败: {error}"))
    })
}

fn build_target_info(session: &Session, chip_id: Option<u32>) -> TargetInfo {
    let target = session.target();
    let memory_regions = target
        .memory_map
        .iter()
        .map(|region| {
            let (name, kind, range) = match region {
                probe_rs::config::MemoryRegion::Ram(r) => (&r.name, "RAM", &r.range),
                probe_rs::config::MemoryRegion::Nvm(r) => (&r.name, "Flash", &r.range),
                probe_rs::config::MemoryRegion::Generic(r) => (&r.name, "Generic", &r.range),
            };
            MemoryRegion {
                name: name.clone().unwrap_or_default(),
                kind: kind.to_string(),
                address: range.start,
                size: range.end - range.start,
            }
        })
        .collect();

    TargetInfo {
        name: target.name.clone(),
        core_type: format!("{:?}", target.cores.first().map(|c| c.core_type)),
        memory_regions,
        flash_algorithms: target.flash_algorithms.iter().map(|a| a.name.clone()).collect(),
        chip_id,
        core_count: target.cores.len(),
    }
}

/// 替换某个连接槽位：先关闭旧连接（连接信息一并清空），再建立新连接
async fn reconnect_slot(
    slot: &SharedSession,
    info_slot: &Arc<parking_lot::Mutex<Option<ConnectionInfo>>>,
    options: ConnectOptions,
) -> AppResult<TargetInfo> {
    let slot = Arc::clone(slot);
    let info_slot = Arc::clone(info_slot);
    blocking(move || {
        *info_slot.lock() = None;
        drop(slot.lock().take());
        let opened = open_session(&options)?;
        *slot.lock() = Some(opened.session);
        *info_slot.lock() = Some(opened.connection_info);
        Ok(opened.target_info)
    })
    .await
}

/// 断开连接槽位：让芯片继续运行（不复位，避免触发 probe-rs 的 bug），再释放 session
async fn release_slot(
    slot: &SharedSession,
    info_slot: &Arc<parking_lot::Mutex<Option<ConnectionInfo>>>,
) -> AppResult<()> {
    let slot = Arc::clone(slot);
    let info_slot = Arc::clone(info_slot);
    blocking(move || {
        let previous = slot.lock().take();
        if let Some(mut session) = previous {
            if let Ok(mut core) = session.core(0) {
                let _ = core.run();
            }
        }
        *info_slot.lock() = None;
        Ok(())
    })
    .await
}

/// 查询连接状态不能阻塞等 session 锁：烧录期间锁会被持有数分钟，
/// 前端轮询状态时拿不到锁就以连接信息为准（连接期间一直存在）。
fn slot_status(slot: &SharedSession, info_slot: &parking_lot::Mutex<Option<ConnectionInfo>>) -> ConnectionStatus {
    let info = info_slot.lock().clone();
    let connected = match slot.try_lock() {
        Some(guard) => guard.is_some(),
        None => info.is_some(),
    };
    ConnectionStatus { connected, info }
}

#[tauri::command]
pub async fn connect_target(options: ConnectOptions, state: State<'_, AppState>) -> AppResult<TargetInfo> {
    state.rtt_state.stop_if_sharing_main();
    let target_info = reconnect_slot(&state.session, &state.connection_info, options).await?;
    log::info!("=== 连接完成 ===");
    Ok(target_info)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<()> {
    state.rtt_state.stop_if_sharing_main();
    release_slot(&state.session, &state.connection_info).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub info: Option<ConnectionInfo>,
}

#[tauri::command]
pub async fn get_connection_status(state: State<'_, AppState>) -> AppResult<ConnectionStatus> {
    Ok(slot_status(&state.session, &state.connection_info))
}

// ==================== RTT 独立连接命令 ====================

#[tauri::command]
pub async fn connect_rtt(options: ConnectOptions, state: State<'_, AppState>) -> AppResult<TargetInfo> {
    // 换连接前先让正在运行的 RTT 轮询退出
    state.rtt_state.run.stop();
    reconnect_slot(&state.rtt_session, &state.rtt_connection_info, options).await
}

#[tauri::command]
pub async fn disconnect_rtt(state: State<'_, AppState>) -> AppResult<()> {
    state.rtt_state.run.stop();
    release_slot(&state.rtt_session, &state.rtt_connection_info).await
}

#[tauri::command]
pub async fn get_rtt_connection_status(state: State<'_, AppState>) -> AppResult<ConnectionStatus> {
    Ok(slot_status(&state.rtt_session, &state.rtt_connection_info))
}

// 诊断命令：列出所有 USB 设备（特别是 CMSIS-DAP 相关的）
fn diagnose_usb_devices() -> AppResult<Vec<UsbDeviceInfo>> {
    log::info!("=== USB Device Diagnosis Start ===");

    let mut devices = Vec::new();

    for device_info in nusb::list_devices().map_err(|e| AppError::ProbeError(e.to_string()))? {
        let vid = device_info.vendor_id();
        let pid = device_info.product_id();

        // 只显示可能是 DAP 的设备 (VID=0xFAED 或其他已知 CMSIS-DAP VID)
        let is_potential_dap = vid == 0xFAED  // Ahypnis
            || vid == 0x0D28  // ARM DAPLink
            || vid == 0xC251  // Keil
            || vid == 0x1366  // SEGGER
            || vid == 0x0483; // STMicroelectronics

        if !is_potential_dap {
            continue;
        }

        let manufacturer = device_info.manufacturer_string().map(|s| s.to_string());
        let product = device_info.product_string().map(|s| s.to_string());
        let serial = device_info.serial_number().map(|s| s.to_string());

        log::info!(
            "Found USB device: VID={:#06x}, PID={:#06x}, bus={}, addr={}",
            vid,
            pid,
            device_info.bus_number(),
            device_info.device_address()
        );
        log::info!("  Manufacturer: {:?}", manufacturer);
        log::info!("  Product: {:?}", product);
        log::info!("  Serial: {:?}", serial);

        // 获取接口信息
        let mut interfaces = Vec::new();
        for iface in device_info.interfaces() {
            let iface_str = iface.interface_string().map(|s| s.to_string());

            log::info!(
                "    Interface {}: class={:#04x}, subclass={:#04x}, protocol={:#04x}, string={:?}",
                iface.interface_number(),
                iface.class(),
                iface.subclass(),
                iface.protocol(),
                iface_str
            );

            // 检查是否是 CMSIS-DAP v2 (Vendor class + 包含 "CMSIS-DAP" 字符串)
            let is_cmsis_dap_v2 = iface.class() == 0xFF  // Vendor Specific
                && iface_str.as_ref().map(|s| s.contains("CMSIS-DAP")).unwrap_or(false);

            if is_cmsis_dap_v2 {
                log::info!("    ^^^ This is CMSIS-DAP v2 interface!");
            }

            interfaces.push(UsbInterfaceInfo {
                interface_number: iface.interface_number(),
                class: iface.class(),
                subclass: iface.subclass(),
                protocol: iface.protocol(),
                interface_string: iface_str,
            });
        }

        devices.push(UsbDeviceInfo {
            vendor_id: vid,
            product_id: pid,
            manufacturer,
            product,
            serial_number: serial,
            bus_number: device_info.bus_number(),
            device_address: device_info.device_address(),
            interfaces,
        });
    }

    log::info!("=== USB Device Diagnosis End ===");
    log::info!("Found {} potential DAP devices", devices.len());

    Ok(devices)
}

/// USB 权限状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbPermissionStatus {
    pub has_permission: bool,
    pub udev_rules_installed: bool,
    pub detected_dap_devices: Vec<UsbDeviceInfo>,
    pub suggestions: Vec<String>,
}

/// 检查 USB 权限状态
#[tauri::command]
pub async fn check_usb_permissions() -> AppResult<UsbPermissionStatus> {
    blocking(check_usb_permissions_blocking).await
}

fn check_usb_permissions_blocking() -> AppResult<UsbPermissionStatus> {
    log::info!("=== USB Permission Check Start ===");

    let mut status = UsbPermissionStatus {
        has_permission: false,
        udev_rules_installed: false,
        detected_dap_devices: Vec::new(),
        suggestions: Vec::new(),
    };

    // 检测 CMSIS-DAP 设备
    let devices = diagnose_usb_devices()?;
    status.detected_dap_devices = devices.clone();

    if devices.is_empty() {
        status
            .suggestions
            .push("未检测到CMSIS-DAP调试器，请检查USB连接".to_string());
        return Ok(status);
    }

    // 尝试打开设备以测试权限
    let lister = Lister::new();
    let probes = lister.list_all();

    if !probes.is_empty() {
        // 尝试打开第一个探针
        match probes[0].open() {
            Ok(_) => {
                status.has_permission = true;
                log::info!("USB权限检查: 成功");
            }
            Err(e) => {
                log::warn!("USB权限检查失败: {}", e);
                status.has_permission = false;

                // 检查是否是权限问题
                let error_msg = e.to_string().to_lowercase();
                if error_msg.contains("permission") || error_msg.contains("access denied") {
                    status.suggestions.push("USB设备权限不足".to_string());
                    status.suggestions.push("需要安装udev规则文件".to_string());
                }
            }
        }
    }

    // 检查 udev 规则是否已安装
    status.udev_rules_installed = crate::udev::check_udev_rules_installed();
    if !status.udev_rules_installed {
        status.suggestions.push("未检测到udev规则文件".to_string());
        status
            .suggestions
            .push("点击下方按钮自动安装，或手动运行: sudo ./install-udev-rules.sh".to_string());
    }

    log::info!("=== USB Permission Check End ===");
    Ok(status)
}

/// 安装 udev 规则
#[tauri::command]
pub async fn install_udev_rules() -> AppResult<String> {
    log::info!("开始安装 udev 规则...");

    crate::udev::install_udev_rules()?;

    Ok("udev 规则安装成功！请重新插拔调试器。".to_string())
}

/// 获取手动安装说明
#[tauri::command]
pub async fn get_udev_install_instructions() -> AppResult<String> {
    Ok(crate::udev::get_manual_install_instructions())
}
