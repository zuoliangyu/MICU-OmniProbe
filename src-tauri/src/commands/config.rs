use crate::commands::blocking;
use crate::error::{AppError, AppResult};
use crate::pack::manager::{PackInfo, PackManager};
use crate::pack::target_gen;
use parking_lot::Mutex;
use probe_rs::config::Registry;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

// 在创建芯片注册表前注册 Espressif 插件，保留 ESP32 芯片、探针和烧录格式支持。
pub static TARGET_REGISTRY: std::sync::LazyLock<Mutex<Registry>> = std::sync::LazyLock::new(|| {
    probe_rs_espressif::register_plugin();
    Mutex::new(Registry::from_builtin_families())
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChipInfo {
    pub name: String,
    pub vendor: String,
    pub family: String,
    pub cores: Vec<CoreInfo>,
    pub memory_regions: Vec<MemoryRegionInfo>,
    pub flash_algorithms: Vec<FlashAlgorithmInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreInfo {
    pub name: String,
    pub core_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRegionInfo {
    pub name: String,
    pub kind: String,
    pub address: u64,
    pub size: u64,
    pub page_size: Option<u64>,
    pub sector_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashAlgorithmInfo {
    pub name: String,
    pub default: bool,
    pub load_address: u64,
    pub data_section_offset: u64,
}

// 内置常用芯片列表（静态数据）
const BUILTIN_CHIPS: &[&str] = &[
    // STM32F0
    "STM32F030C6Tx",
    "STM32F030C8Tx",
    "STM32F030F4Px",
    "STM32F030K6Tx",
    "STM32F030R8Tx",
    "STM32F031C4Tx",
    "STM32F031C6Tx",
    "STM32F042C4Tx",
    "STM32F042C6Tx",
    "STM32F042K4Tx",
    "STM32F042K6Tx",
    // STM32F1
    "STM32F100C4Tx",
    "STM32F100C6Tx",
    "STM32F100C8Tx",
    "STM32F100CBTx",
    "STM32F100R4Tx",
    "STM32F100R6Tx",
    "STM32F100R8Tx",
    "STM32F100RBTx",
    "STM32F100RCTx",
    "STM32F100RDTx",
    "STM32F100RETx",
    "STM32F100V8Tx",
    "STM32F100VBTx",
    "STM32F100VCTx",
    "STM32F100VDTx",
    "STM32F100VETx",
    "STM32F101C4Tx",
    "STM32F101C6Tx",
    "STM32F101C8Tx",
    "STM32F101CBTx",
    "STM32F101R4Tx",
    "STM32F101R6Tx",
    "STM32F101R8Tx",
    "STM32F101RBTx",
    "STM32F101RCTx",
    "STM32F101RDTx",
    "STM32F101RETx",
    "STM32F101RFTx",
    "STM32F101RGTx",
    "STM32F101V8Tx",
    "STM32F101VBTx",
    "STM32F101VCTx",
    "STM32F103C4Tx",
    "STM32F103C6Tx",
    "STM32F103C8Tx",
    "STM32F103CBTx",
    "STM32F103R4Tx",
    "STM32F103R6Tx",
    "STM32F103R8Tx",
    "STM32F103RBTx",
    "STM32F103RCTx",
    "STM32F103RDTx",
    "STM32F103RETx",
    "STM32F103RFTx",
    "STM32F103RGTx",
    "STM32F103V8Tx",
    "STM32F103VBTx",
    "STM32F103VCTx",
    "STM32F103VDTx",
    "STM32F103VETx",
    "STM32F103VFTx",
    "STM32F103VGTx",
    "STM32F103ZCTx",
    "STM32F103ZDTx",
    "STM32F103ZETx",
    "STM32F103ZFTx",
    "STM32F103ZGTx",
    // STM32F2
    "STM32F205RBTx",
    "STM32F205RCTx",
    "STM32F205RETx",
    "STM32F205RFTx",
    "STM32F205RGTx",
    "STM32F205VBTx",
    "STM32F205VCTx",
    "STM32F205VETx",
    "STM32F205VFTx",
    "STM32F205VGTx",
    "STM32F205ZCTx",
    "STM32F205ZETx",
    "STM32F205ZFTx",
    "STM32F205ZGTx",
    // STM32F3
    "STM32F301C6Tx",
    "STM32F301C8Tx",
    "STM32F301K6Ux",
    "STM32F301K8Ux",
    "STM32F301R6Tx",
    "STM32F301R8Tx",
    "STM32F302C6Tx",
    "STM32F302C8Tx",
    "STM32F302CBTx",
    "STM32F302CCTx",
    "STM32F302K6Ux",
    "STM32F302K8Ux",
    "STM32F302R6Tx",
    "STM32F302R8Tx",
    "STM32F302RBTx",
    "STM32F302RCTx",
    "STM32F302RDTx",
    "STM32F302RETx",
    // STM32F4
    "STM32F401CBUx",
    "STM32F401CCUx",
    "STM32F401CDUx",
    "STM32F401CEUx",
    "STM32F401RBTx",
    "STM32F401RCTx",
    "STM32F401RDTx",
    "STM32F401RETx",
    "STM32F401VBTx",
    "STM32F401VCTx",
    "STM32F401VDTx",
    "STM32F401VETx",
    "STM32F405OETx",
    "STM32F405OGTx",
    "STM32F405RGTx",
    "STM32F405VGTx",
    "STM32F405ZGTx",
    "STM32F407IETx",
    "STM32F407IGTx",
    "STM32F407VETx",
    "STM32F407VGTx",
    "STM32F407ZETx",
    "STM32F407ZGTx",
    "STM32F411CCUx",
    "STM32F411CEUx",
    "STM32F411RCTx",
    "STM32F411RETx",
    "STM32F411VCTx",
    "STM32F411VETx",
    // STM32G0
    "STM32G030C6Tx",
    "STM32G030C8Tx",
    "STM32G030F6Px",
    "STM32G030J6Mx",
    "STM32G030K6Tx",
    "STM32G030K8Tx",
    "STM32G031C4Tx",
    "STM32G031C6Tx",
    "STM32G031C8Tx",
    "STM32G031F4Px",
    "STM32G031F6Px",
    "STM32G031F8Px",
    "STM32G031G4Ux",
    "STM32G031G6Ux",
    "STM32G031G8Ux",
    "STM32G031J4Mx",
    "STM32G031J6Mx",
    "STM32G031K4Tx",
    "STM32G031K6Tx",
    "STM32G031K8Tx",
    "STM32G031Y8Yx",
    // STM32G4
    "STM32G431C6Tx",
    "STM32G431C8Tx",
    "STM32G431CBTx",
    "STM32G431K6Tx",
    "STM32G431K8Tx",
    "STM32G431KBTx",
    "STM32G431R6Tx",
    "STM32G431R8Tx",
    "STM32G431RBTx",
    "STM32G431V6Tx",
    "STM32G431V8Tx",
    "STM32G431VBTx",
    // STM32L0
    "STM32L010C6Tx",
    "STM32L010F4Px",
    "STM32L010K4Tx",
    "STM32L010K8Tx",
    "STM32L010R8Tx",
    "STM32L010RBTx",
    "STM32L011D3Px",
    "STM32L011D4Px",
    "STM32L011E3Yx",
    "STM32L011E4Yx",
    "STM32L011F3Px",
    "STM32L011F4Px",
    "STM32L011G3Ux",
    "STM32L011G4Ux",
    "STM32L011K3Tx",
    "STM32L011K4Tx",
    // STM32L4
    "STM32L412C8Tx",
    "STM32L412CBTx",
    "STM32L412K8Tx",
    "STM32L412KBTx",
    "STM32L412R8Tx",
    "STM32L412RBTx",
    "STM32L412T8Yx",
    "STM32L412TBYx",
    "STM32L431CBTx",
    "STM32L431CCTx",
    "STM32L431KBUx",
    "STM32L431KCUx",
    "STM32L431RBTx",
    "STM32L431RCTx",
    "STM32L431VCTx",
    // GD32F1 (兼容STM32F1)
    "GD32F103C8T6",
    "GD32F103CBT6",
    "GD32F103RBT6",
    "GD32F103RCT6",
    "GD32F103RET6",
    "GD32F103VBT6",
    "GD32F103VCT6",
    "GD32F103VET6",
    // GD32F0
    "GD32F190C8T6",
    "GD32F190R8T6",
    "GD32F190T8U6",
    "GD32F150C8T6",
    "GD32F150R8T6",
    "GD32F150G8U6",
    // GD32F2
    "GD32F205RCT6",
    "GD32F205RET6",
    "GD32F205VCT6",
    "GD32F205VET6",
    "GD32F207RCT6",
    "GD32F207RET6",
    "GD32F207VCT6",
    "GD32F207VET6",
    // GD32F3
    "GD32F303CCT6",
    "GD32F303RCT6",
    "GD32F303RET6",
    "GD32F303VCT6",
    "GD32F303VET6",
    "GD32F305RCT6",
    "GD32F305RET6",
    "GD32F305VCT6",
    "GD32F307RCT6",
    "GD32F307RET6",
    "GD32F307VCT6",
    "GD32F307VET6",
    // GD32F4
    "GD32F405RGT6",
    "GD32F405VGT6",
    "GD32F405ZGT6",
    "GD32F407RET6",
    "GD32F407RGT6",
    "GD32F407VET6",
    "GD32F407VGT6",
    "GD32F407ZET6",
    "GD32F407ZGT6",
    "GD32F450VGT6",
    "GD32F450ZGT6",
    // 注意：GD32F470 系列需要通过 CMSIS-Pack 导入才能使用
    // GD32E
    "GD32E103C8T6",
    "GD32E103CBT6",
    "GD32E103RBT6",
    "GD32E103RCT6",
    "GD32E230C8T6",
    "GD32E230F8P6",
    "GD32E230G8U6",
    // GD32L (低功耗系列)
    "GD32L233C8T6",
    "GD32L233CCT6",
    "GD32L233RCT6",
    // CW32 (武汉芯源)
    "CW32F030C8T6",
    "CW32F030C6T6",
    "CW32F003F4P6",
    "CW32F003F6P7",
    "CW32L031C8T6",
    "CW32L052C8T6",
    "CW32F103C8T6",
    "CW32F103CBT6",
    // nRF
    "nRF52832_xxAA",
    "nRF52833_xxAA",
    "nRF52840_xxAA",
    "nRF51822_xxAA",
    "nRF51822_xxAB",
    "nRF51822_xxAC",
    // RP2040
    "rp2040",
    // ESP32 (probe-rs支持)
    "esp32c3",
    "esp32c6",
    "esp32s3",
];

#[tauri::command]
pub async fn search_chips(query: String) -> AppResult<Vec<String>> {
    let query_lower = query.to_lowercase();
    let mut all_chips = Vec::new();

    // 1. 从内置芯片列表搜索
    let builtin_matched: Vec<String> = BUILTIN_CHIPS
        .iter()
        .filter(|chip| chip.to_lowercase().contains(&query_lower))
        .map(|s| s.to_string())
        .collect();
    all_chips.extend(builtin_matched);

    // 2. 从 probe-rs 注册的所有目标中搜索（包含从 Pack 导入的）
    let registry = TARGET_REGISTRY.lock();
    for family in registry.families() {
        for variant in family.variants() {
            let chip_name = variant.name.clone();
            if chip_name.to_lowercase().contains(&query_lower) {
                // 避免重复
                if !all_chips.contains(&chip_name) {
                    all_chips.push(chip_name);
                }
            }
        }
    }
    drop(registry);

    // 限制返回数量并排序
    all_chips.sort();
    all_chips.truncate(50);

    Ok(all_chips)
}

/// 初始化：加载所有已导入的 Pack 到 probe-rs
/// 应该在应用启动时调用
#[tauri::command]
pub async fn init_packs() -> AppResult<usize> {
    // 解压、解析 PDSC/FLM 都是同步文件操作，放到阻塞线程
    blocking(init_packs_blocking).await
}

fn init_packs_blocking() -> AppResult<usize> {
    let manager = PackManager::new()?;
    let packs = manager.list_packs()?;

    let pack_count = packs.len();
    let mut total_devices = 0;

    for pack in packs {
        let pack_dir = match manager.get_pack_dir(&pack.name) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("跳过名称非法的 Pack {}: {}", pack.name, e);
                continue;
            }
        };

        match register_pack_devices(&pack_dir, &pack.name, None) {
            Ok(count) => {
                total_devices += count;
                log::info!("从 Pack {} 加载了 {} 个设备", pack.name, count);
            }
            Err(e) => {
                log::warn!("从 Pack {} 加载设备失败: {}", pack.name, e);
            }
        }
    }

    log::info!("总共加载了 {} 个设备从 {} 个 Pack", total_devices, pack_count);

    Ok(total_devices)
}

/// 获取芯片的回退兼容型号
/// 当 probe-rs 不支持某个芯片时，尝试使用相似架构的芯片
fn get_fallback_chip(chip_name: &str) -> Option<String> {
    let chip_upper = chip_name.to_uppercase();

    // GD32F470 系列 -> GD32F407 (相似的 Cortex-M4 架构)
    if chip_upper.starts_with("GD32F470") {
        return Some("GD32F407".to_string());
    }

    // GD32F450 系列 -> GD32F407
    if chip_upper.starts_with("GD32F450") {
        return Some("GD32F407".to_string());
    }

    // 可以添加更多回退规则
    // 例如：GD32F3xx -> STM32F3xx

    None
}

/// 从 Pack 目录注册设备到 probe-rs
fn register_pack_devices(
    pack_dir: &Path,
    pack_name: &str,
    progress_callback: Option<&crate::pack::progress::ProgressCallback>,
) -> AppResult<usize> {
    // 解析 Pack 中的设备定义
    let devices = target_gen::parse_devices_from_pack(pack_dir, progress_callback)?;

    if devices.is_empty() {
        return Err(AppError::PackError("Pack 中未找到设备定义".to_string()));
    }

    log::info!("从 Pack {} 解析到 {} 个设备", pack_name, devices.len());

    // 生成 probe-rs YAML 格式（包含 Flash 算法）
    let generated = target_gen::generate_probe_rs_yaml_with_algo(&devices, pack_name, pack_dir, progress_callback)?;
    let yaml_content = generated.yaml;

    // 保存 YAML 文件到 Pack 目录
    let yaml_path = pack_dir.join("targets.yaml");
    std::fs::write(&yaml_path, &yaml_content)?;

    log::info!("生成 YAML 文件: {:?}", yaml_path);

    // 只在注册时持锁；后面生成扫描报告还要读文件，不能一直挡住芯片搜索和连接
    let registered = TARGET_REGISTRY.lock().add_target_family_from_yaml(&yaml_content);
    match registered {
        Ok(_) => {
            log::info!("成功注册 {} 个设备到 probe-rs（包含 Flash 算法）", devices.len());
            // 生成并保存扫描报告
            let report = target_gen::generate_scan_report(&devices, pack_name, &generated.device_algorithms);
            if let Err(e) = target_gen::save_scan_report(&report, pack_dir) {
                log::warn!("保存扫描报告失败: {}", e);
            } else {
                log::info!(
                    "扫描报告已生成: {} 个设备，{} 个有算法，{} 个无算法",
                    report.total_devices,
                    report.devices_with_algo,
                    report.devices_without_algo
                );
            }

            Ok(devices.len())
        }
        Err(e) => Err(AppError::PackError(format!("注册设备到 probe-rs 失败: {}", e))),
    }
}

#[tauri::command]
pub async fn get_chip_info(chip_name: String) -> AppResult<ChipInfo> {
    // 尝试从probe-rs获取目标信息
    let registry = TARGET_REGISTRY.lock();
    let target = match registry.get_target_by_name(&chip_name) {
        Ok(t) => t,
        Err(e) => {
            // 如果找不到精确匹配，尝试使用家族名称作为回退
            // 例如：GD32F470ZGT6 -> GD32F407 (相似架构)
            let fallback_chip = get_fallback_chip(&chip_name);
            if let Some(fallback) = fallback_chip {
                log::warn!(
                    "芯片 {} 不在 probe-rs 数据库中，尝试使用兼容芯片: {}",
                    chip_name,
                    fallback
                );
                registry.get_target_by_name(&fallback).map_err(|e2| {
                    AppError::ConfigError(format!(
                        "未找到芯片 {} 及其兼容芯片 {}: 原始错误: {}, 回退错误: {}",
                        chip_name, fallback, e, e2
                    ))
                })?
            } else {
                return Err(AppError::ConfigError(format!("未找到芯片 {}: {}", chip_name, e)));
            }
        }
    };

    let chip_info = ChipInfo {
        name: target.name.clone(),
        vendor: "".to_string(), // probe-rs 0.27 不直接提供厂商信息
        family: "".to_string(),
        cores: target
            .cores
            .iter()
            .map(|c| CoreInfo {
                name: c.name.clone(),
                core_type: format!("{:?}", c.core_type),
            })
            .collect(),
        memory_regions: target
            .memory_map
            .iter()
            .map(|region| match region {
                probe_rs::config::MemoryRegion::Ram(r) => MemoryRegionInfo {
                    name: r.name.clone().unwrap_or_default(),
                    kind: "RAM".to_string(),
                    address: r.range.start,
                    size: r.range.end - r.range.start,
                    page_size: None,
                    sector_size: None,
                },
                probe_rs::config::MemoryRegion::Nvm(r) => MemoryRegionInfo {
                    name: r.name.clone().unwrap_or_default(),
                    kind: "Flash".to_string(),
                    address: r.range.start,
                    size: r.range.end - r.range.start,
                    page_size: None,
                    sector_size: None,
                },
                probe_rs::config::MemoryRegion::Generic(r) => MemoryRegionInfo {
                    name: r.name.clone().unwrap_or_default(),
                    kind: "Generic".to_string(),
                    address: r.range.start,
                    size: r.range.end - r.range.start,
                    page_size: None,
                    sector_size: None,
                },
            })
            .collect(),
        flash_algorithms: target
            .flash_algorithms
            .iter()
            .map(|a| FlashAlgorithmInfo {
                name: a.name.clone(),
                default: a.default,
                load_address: a.load_address.unwrap_or(0),
                data_section_offset: a.data_section_offset,
            })
            .collect(),
    };

    Ok(chip_info)
}

#[tauri::command]
pub async fn import_pack(app: tauri::AppHandle, pack_path: String) -> AppResult<PackInfo> {
    blocking(move || import_pack_blocking(app, pack_path)).await
}

fn import_pack_blocking(app: tauri::AppHandle, pack_path: String) -> AppResult<PackInfo> {
    let path = PathBuf::from(&pack_path);

    if !path.exists() {
        return Err(AppError::FileError("Pack文件不存在".to_string()));
    }

    let manager = PackManager::new()?;
    let pack_info = manager.import_pack(&path)?;

    // 导入后，尝试从 Pack 中提取设备定义并注册到 probe-rs
    let pack_dir = manager.get_pack_dir(&pack_info.name)?;

    // 创建进度回调，通过Tauri事件发送进度
    use crate::pack::progress::{PackScanProgress, ProgressCallback};
    let callback: ProgressCallback = Box::new(move |progress: PackScanProgress| {
        let _ = app.emit("pack-scan-progress", &progress);
    });

    match register_pack_devices(&pack_dir, &pack_info.name, Some(&callback)) {
        Ok(count) => {
            log::info!("成功从 Pack {} 注册了 {} 个设备到 probe-rs", pack_info.name, count);
        }
        Err(e) => {
            log::warn!(
                "从 Pack {} 注册设备失败: {}，Pack 已导入但设备可能无法使用",
                pack_info.name,
                e
            );
        }
    }

    Ok(pack_info)
}

#[tauri::command]
pub async fn list_imported_packs() -> AppResult<Vec<PackInfo>> {
    let manager = PackManager::new()?;
    let packs = manager.list_packs()?;
    Ok(packs)
}

#[tauri::command]
pub async fn delete_pack(pack_name: String) -> AppResult<()> {
    blocking(move || PackManager::new()?.delete_pack(&pack_name)).await
}

/// 获取Pack扫描报告
#[tauri::command]
pub async fn get_pack_scan_report(pack_name: String) -> AppResult<crate::pack::scan_report::PackScanReport> {
    let manager = PackManager::new()?;
    let pack_dir = manager.get_pack_dir(&pack_name)?;

    target_gen::load_scan_report(&pack_dir)
}

/// 获取当前Pack目录路径
#[tauri::command]
pub async fn get_packs_directory() -> AppResult<String> {
    let packs_dir = crate::pack::paths::get_packs_dir();
    Ok(packs_dir.to_string_lossy().to_string())
}

/// 设置自定义Pack目录路径
#[tauri::command]
pub async fn set_custom_packs_directory(path: Option<String>) -> AppResult<()> {
    log::info!("设置自定义Pack目录: {:?}", path);

    // 验证路径是否有效
    if let Some(ref p) = path {
        let path_buf = std::path::PathBuf::from(p);
        if !path_buf.exists() {
            // 尝试创建目录
            std::fs::create_dir_all(&path_buf).map_err(crate::error::AppError::IoError)?;
        }

        if !path_buf.is_dir() {
            return Err(crate::error::AppError::PackError("指定的路径不是一个目录".to_string()));
        }
    }

    crate::app_config::set_custom_packs_dir(path)?;

    log::info!("Pack目录配置已更新");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::TARGET_REGISTRY;

    #[test]
    fn builtin_registry_preserves_esp32_and_arm_targets() {
        let registry = TARGET_REGISTRY.lock();
        for name in ["esp32c3", "esp32s3", "STM32F103C8"] {
            registry
                .get_target_by_name(name)
                .unwrap_or_else(|error| panic!("无法加载内置芯片 {name}: {error}"));
        }
    }
}
