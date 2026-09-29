// Pack 到 probe-rs 目标定义的转换模块
// 参考 probe-rs 的 target-gen 工具实现

use crate::error::{AppError, AppResult};

/// Pack 扫描器版本
/// 用于检测旧版本生成的配置文件,提示用户重新扫描
pub const PACK_SCANNER_VERSION: &str = "2.0.0";
use crate::pack::flash_algo;
use crate::pack::progress::{PackScanProgress, ProgressCallback, ScanPhase};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// 设备定义（从 PDSC 解析）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDefinition {
    pub name: String,
    pub processor: ProcessorInfo,
    pub memory: MemoryInfo,
    pub flash_algorithm: Option<String>, // Flash 算法文件名
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessorInfo {
    pub core: String, // Cortex-M0, Cortex-M3, Cortex-M4, etc.
    pub fpu: bool,
    pub mpu: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub ram_start: u64,
    pub ram_size: u64,
    pub flash_start: u64,
    pub flash_size: u64,
}

/// 从 Pack 目录解析所有设备定义
pub fn parse_devices_from_pack(
    pack_dir: &Path,
    progress_callback: Option<&ProgressCallback>,
) -> AppResult<Vec<DeviceDefinition>> {
    // 查找 PDSC 文件
    let pdsc_path = find_pdsc_file(pack_dir)?;
    let content = fs::read_to_string(&pdsc_path)?;

    parse_devices_from_pdsc(&content, progress_callback)
}

/// 查找 Pack 目录中的 PDSC 文件
fn find_pdsc_file(pack_dir: &Path) -> AppResult<std::path::PathBuf> {
    for entry in fs::read_dir(pack_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "pdsc") {
            return Ok(path);
        }
    }

    Err(AppError::PackError("未找到 PDSC 文件".to_string()))
}

/// 从 PDSC 内容解析设备定义
/// 支持 CMSIS Pack 的层级结构：devices -> family -> subFamily -> device
/// processor、memory、algorithm 可以在任意层级定义，子级继承父级的配置
pub fn parse_devices_from_pdsc(
    content: &str,
    progress_callback: Option<&ProgressCallback>,
) -> AppResult<Vec<DeviceDefinition>> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut devices = Vec::new();
    let mut buf = Vec::new();

    let mut in_devices = false;

    // 层级继承：family -> subFamily -> device
    // 每个层级可以定义 processor、memory、algorithm，子级继承父级
    let mut family_processor: Option<ProcessorInfo> = None;
    let mut family_memory: Option<MemoryInfo> = None;
    let mut family_algorithm: Option<String> = None;

    let mut subfamily_processor: Option<ProcessorInfo> = None;
    let mut subfamily_memory: Option<MemoryInfo> = None;
    let mut subfamily_algorithm: Option<String> = None;

    let mut current_device: Option<DeviceDefinition> = None;
    let mut current_processor: Option<ProcessorInfo> = None;

    // 跟踪当前层级
    let mut in_family = false;
    let mut in_subfamily = false;
    let mut in_device = false;

    // 统计每个 subFamily 的设备数
    let mut subfamily_device_count = 0;

    // 报告开始解析
    if let Some(callback) = progress_callback {
        callback(PackScanProgress::new(
            ScanPhase::Parsing,
            0,
            1,
            "开始解析 PDSC 文件".to_string(),
        ));
    }

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"devices" => {
                        in_devices = true;
                    }
                    b"family" if in_devices => {
                        in_family = true;
                        // 清除 family 级别的继承数据
                        family_processor = None;
                        family_memory = None;
                        family_algorithm = None;
                    }
                    b"subFamily" if in_family => {
                        in_subfamily = true;
                        // 清除 subFamily 级别的继承数据，但保留 family 的
                        subfamily_processor = None;
                        subfamily_memory = None;
                        subfamily_algorithm = None;

                        // 提取 subFamily 名称用于日志
                        let mut subfamily_name = String::new();
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"DsubFamily" {
                                subfamily_name = String::from_utf8_lossy(&attr.value).to_string();
                                break;
                            }
                        }
                        log::info!("开始解析 subFamily: {}", subfamily_name);
                    }
                    b"device" if in_devices => {
                        in_device = true;
                        // 开始新设备
                        let mut name = String::new();

                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Dname" {
                                name = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }

                        if !name.is_empty() {
                            // 统计 subFamily 中的设备数
                            if in_subfamily {
                                subfamily_device_count += 1;
                            }

                            // 从父级继承配置
                            let inherited_processor = subfamily_processor
                                .clone()
                                .or_else(|| family_processor.clone())
                                .unwrap_or(ProcessorInfo {
                                    core: String::new(),
                                    fpu: false,
                                    mpu: false,
                                });

                            let inherited_memory = subfamily_memory
                                .clone()
                                .or_else(|| family_memory.clone())
                                .unwrap_or(MemoryInfo {
                                    ram_start: 0,
                                    ram_size: 0,
                                    flash_start: 0,
                                    flash_size: 0,
                                });

                            let inherited_algorithm = subfamily_algorithm.clone().or_else(|| family_algorithm.clone());

                            current_device = Some(DeviceDefinition {
                                name,
                                processor: inherited_processor,
                                memory: inherited_memory,
                                flash_algorithm: inherited_algorithm,
                            });
                        }
                    }
                    b"processor" if in_devices => {
                        let mut core = String::new();
                        let mut fpu = false;
                        let mut mpu = false;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Dcore" => {
                                    core = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"Dfpu" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    fpu = val == "1" || val.to_lowercase() == "true" || val.to_lowercase() == "sp_fpu";
                                }
                                b"Dmpu" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    mpu = val == "1" || val.to_lowercase() == "true";
                                }
                                _ => {}
                            }
                        }

                        let proc_info = ProcessorInfo { core, fpu, mpu };

                        // 根据当前层级保存 processor 信息
                        if in_device {
                            current_processor = Some(proc_info);
                        } else if in_subfamily {
                            subfamily_processor = Some(proc_info);
                        } else if in_family {
                            family_processor = Some(proc_info);
                        }
                    }
                    b"memory" if in_devices => {
                        let mut id = String::new();
                        let mut name_attr = String::new();
                        let mut start = 0u64;
                        let mut size = 0u64;
                        let mut is_default = false;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => {
                                    id = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"name" => {
                                    name_attr = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"start" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    start = parse_hex_or_dec(&val).unwrap_or(0);
                                }
                                b"size" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    size = parse_hex_or_dec(&val).unwrap_or(0);
                                }
                                b"default" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    is_default = val == "1" || val.to_lowercase() == "true";
                                }
                                _ => {}
                            }
                        }

                        // 使用 id 或 name 来判断内存类型
                        let mem_id = if !id.is_empty() { id } else { name_attr };
                        let mem_id_upper = mem_id.to_uppercase();

                        // 确定目标 MemoryInfo
                        let target_memory = if in_device {
                            current_device.as_mut().map(|d| &mut d.memory)
                        } else if in_subfamily {
                            if subfamily_memory.is_none() {
                                subfamily_memory = Some(MemoryInfo {
                                    ram_start: 0,
                                    ram_size: 0,
                                    flash_start: 0,
                                    flash_size: 0,
                                });
                            }
                            subfamily_memory.as_mut()
                        } else if in_family {
                            if family_memory.is_none() {
                                family_memory = Some(MemoryInfo {
                                    ram_start: 0,
                                    ram_size: 0,
                                    flash_start: 0,
                                    flash_size: 0,
                                });
                            }
                            family_memory.as_mut()
                        } else {
                            None
                        };

                        if let Some(mem) = target_memory {
                            if mem_id_upper.contains("IROM")
                                || mem_id_upper.contains("FLASH")
                                || mem_id_upper.contains("ROM")
                            {
                                // Flash: 优先使用 default 或更大的区域
                                if mem.flash_size == 0 || is_default || size > mem.flash_size {
                                    mem.flash_start = start;
                                    mem.flash_size = size;
                                }
                            } else if mem_id_upper.contains("IRAM")
                                || mem_id_upper.contains("RAM")
                                || mem_id_upper.contains("SRAM")
                            {
                                // RAM: 优先使用 default="1" 的区域，或者主 SRAM (0x20000000)
                                let should_update = mem.ram_size == 0
                                    || is_default
                                    || (start >= 0x20000000 && mem.ram_start < 0x20000000);

                                if should_update {
                                    mem.ram_start = start;
                                    mem.ram_size = size;
                                }
                            }
                        }
                    }
                    b"algorithm" if in_devices => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"name" {
                                let algo_name = String::from_utf8_lossy(&attr.value).to_string();

                                // 根据当前层级保存 algorithm
                                if in_device {
                                    if let Some(ref mut dev) = current_device {
                                        dev.flash_algorithm = Some(algo_name);
                                    }
                                } else if in_subfamily {
                                    subfamily_algorithm = Some(algo_name);
                                } else if in_family {
                                    family_algorithm = Some(algo_name);
                                }
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                // 处理自闭合标签（如 <processor .../>, <memory .../>, <algorithm .../>）
                match e.name().as_ref() {
                    b"processor" if in_devices => {
                        let mut core = String::new();
                        let mut fpu = false;
                        let mut mpu = false;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Dcore" => {
                                    core = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"Dfpu" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    fpu = val == "1" || val.to_lowercase() == "true" || val.to_lowercase() == "sp_fpu";
                                }
                                b"Dmpu" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    mpu = val == "1" || val.to_lowercase() == "true";
                                }
                                _ => {}
                            }
                        }

                        let proc_info = ProcessorInfo { core, fpu, mpu };

                        // 根据当前层级保存 processor 信息
                        if in_device {
                            current_processor = Some(proc_info);
                        } else if in_subfamily {
                            subfamily_processor = Some(proc_info);
                        } else if in_family {
                            family_processor = Some(proc_info);
                        }
                    }
                    b"memory" if in_devices => {
                        let mut id = String::new();
                        let mut name_attr = String::new();
                        let mut start = 0u64;
                        let mut size = 0u64;
                        let mut is_default = false;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => {
                                    id = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"name" => {
                                    name_attr = String::from_utf8_lossy(&attr.value).to_string();
                                }
                                b"start" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    start = parse_hex_or_dec(&val).unwrap_or(0);
                                }
                                b"size" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    size = parse_hex_or_dec(&val).unwrap_or(0);
                                }
                                b"default" => {
                                    let val = String::from_utf8_lossy(&attr.value);
                                    is_default = val == "1" || val.to_lowercase() == "true";
                                }
                                _ => {}
                            }
                        }

                        // 使用 id 或 name 来判断内存类型
                        let mem_id = if !id.is_empty() { id } else { name_attr };
                        let mem_id_upper = mem_id.to_uppercase();

                        // 确定目标 MemoryInfo
                        let target_memory = if in_device {
                            current_device.as_mut().map(|d| &mut d.memory)
                        } else if in_subfamily {
                            if subfamily_memory.is_none() {
                                subfamily_memory = Some(MemoryInfo {
                                    ram_start: 0,
                                    ram_size: 0,
                                    flash_start: 0,
                                    flash_size: 0,
                                });
                            }
                            subfamily_memory.as_mut()
                        } else if in_family {
                            if family_memory.is_none() {
                                family_memory = Some(MemoryInfo {
                                    ram_start: 0,
                                    ram_size: 0,
                                    flash_start: 0,
                                    flash_size: 0,
                                });
                            }
                            family_memory.as_mut()
                        } else {
                            None
                        };

                        if let Some(mem) = target_memory {
                            if mem_id_upper.contains("IROM")
                                || mem_id_upper.contains("FLASH")
                                || mem_id_upper.contains("ROM")
                            {
                                // Flash: 优先使用 default 或更大的区域
                                if mem.flash_size == 0 || is_default || size > mem.flash_size {
                                    mem.flash_start = start;
                                    mem.flash_size = size;
                                }
                            } else if mem_id_upper.contains("IRAM")
                                || mem_id_upper.contains("RAM")
                                || mem_id_upper.contains("SRAM")
                            {
                                // RAM: 优先使用 default="1" 的区域，或者主 SRAM (0x20000000)
                                let should_update = mem.ram_size == 0
                                    || is_default
                                    || (start >= 0x20000000 && mem.ram_start < 0x20000000);

                                if should_update {
                                    mem.ram_start = start;
                                    mem.ram_size = size;
                                }
                            }
                        }
                    }
                    b"algorithm" if in_devices => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"name" {
                                let algo_name = String::from_utf8_lossy(&attr.value).to_string();

                                // 根据当前层级保存 algorithm
                                if in_device {
                                    if let Some(ref mut dev) = current_device {
                                        dev.flash_algorithm = Some(algo_name);
                                    }
                                } else if in_subfamily {
                                    subfamily_algorithm = Some(algo_name);
                                } else if in_family {
                                    family_algorithm = Some(algo_name);
                                }
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"devices" => {
                        in_devices = false;
                    }
                    b"family" => {
                        in_family = false;
                        family_processor = None;
                        family_memory = None;
                        family_algorithm = None;
                    }
                    b"subFamily" => {
                        log::info!("结束解析 subFamily，共解析 {} 个设备", subfamily_device_count);
                        in_subfamily = false;
                        subfamily_processor = None;
                        subfamily_memory = None;
                        subfamily_algorithm = None;
                        subfamily_device_count = 0; // 重置计数器
                    }
                    b"device" => {
                        in_device = false;
                        // 完成当前设备
                        if let Some(mut dev) = current_device.take() {
                            // 如果设备级别有 processor，使用设备级别的
                            if let Some(proc) = current_processor.take() {
                                dev.processor = proc;
                            }

                            // 记录设备信息
                            log::info!(
                                "解析设备: {} - Flash: 0x{:X}+0x{:X}, RAM: 0x{:X}+0x{:X}, Algorithm: {:?}",
                                dev.name,
                                dev.memory.flash_start,
                                dev.memory.flash_size,
                                dev.memory.ram_start,
                                dev.memory.ram_size,
                                dev.flash_algorithm
                            );

                            // 报告进度（每10个设备报告一次）
                            if devices.len() % 10 == 0 {
                                if let Some(callback) = progress_callback {
                                    callback(
                                        PackScanProgress::new(
                                            ScanPhase::ExtractingDevices,
                                            devices.len(),
                                            devices.len() + 1, // 估算值
                                            format!("已解析 {} 个设备", devices.len()),
                                        )
                                        .with_item(dev.name.clone()),
                                    );
                                }
                            }

                            devices.push(dev);
                        }
                        current_processor = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::PackError(format!("解析 PDSC 失败: {}", e)));
            }
            _ => {}
        }
        buf.clear();
    }

    log::info!("从 PDSC 解析出 {} 个设备", devices.len());

    // 报告解析完成
    if let Some(callback) = progress_callback {
        callback(PackScanProgress::new(
            ScanPhase::ExtractingDevices,
            devices.len(),
            devices.len(),
            format!("解析完成，共 {} 个设备", devices.len()),
        ));
    }

    Ok(devices)
}

/// 解析十六进制或十进制数字
fn parse_hex_or_dec(s: &str) -> Option<u64> {
    let s = s.trim();

    if s.starts_with("0x") || s.starts_with("0X") {
        u64::from_str_radix(&s[2..], 16).ok()
    } else {
        s.parse::<u64>().ok()
    }
}

/// Flash 算法信息（用于收集和去重）
struct CollectedAlgo {
    algo: flash_algo::FlashAlgorithm,
    load_address: u64,
}

/// 生成的目标定义：probe-rs YAML + 每个设备匹配到的算法摘要（设备名 → 算法），供扫描报告复用
pub struct GeneratedTargets {
    pub yaml: String,
    pub device_algorithms: std::collections::HashMap<String, crate::pack::scan_report::AlgorithmInfo>,
}

/// 把任意文本写成 YAML 双引号字符串。
///
/// 设备名、算法描述都来自不可信的 PDSC/FLM，里面可能有 `:`、`#`、换行等字符；
/// 直接拼接会让 YAML 解析失败甚至被注入额外结构。JSON 字符串是合法的 YAML 双引号标量。
fn yaml_str(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// 生成 probe-rs YAML 格式的目标定义（包含 Flash 算法）
pub fn generate_probe_rs_yaml_with_algo(
    devices: &[DeviceDefinition],
    family_name: &str,
    pack_dir: &Path,
    progress_callback: Option<&ProgressCallback>,
) -> AppResult<GeneratedTargets> {
    use std::collections::HashMap;

    // 查找所有 FLM 文件
    let flm_files = flash_algo::find_flm_files(pack_dir)?;
    log::info!("在 Pack 中找到 {} 个 FLM 文件", flm_files.len());

    // 报告开始查找算法
    if let Some(callback) = progress_callback {
        callback(PackScanProgress::new(
            ScanPhase::FindingAlgorithms,
            0,
            flm_files.len(),
            format!("找到 {} 个 FLM 文件", flm_files.len()),
        ));
    }

    // 第一遍：收集所有唯一的 flash 算法，并记录设备与算法的映射
    let mut algo_map: HashMap<String, CollectedAlgo> = HashMap::new();
    let mut device_algo_map: HashMap<String, String> = HashMap::new(); // device_name -> algo_name
    let mut device_algorithms: HashMap<String, crate::pack::scan_report::AlgorithmInfo> = HashMap::new();

    let total_devices = devices.len();
    for (idx, device) in devices.iter().enumerate() {
        // 报告匹配进度（每5个设备报告一次）
        if idx % 5 == 0 {
            if let Some(callback) = progress_callback {
                callback(
                    PackScanProgress::new(
                        ScanPhase::MatchingAlgorithms,
                        idx,
                        total_devices,
                        format!("正在匹配算法 ({}/{})", idx, total_devices),
                    )
                    .with_item(device.name.clone()),
                );
            }
        }

        if device.memory.flash_size > 0 {
            if let Some(flm_path) = flash_algo::match_flm_for_device(&flm_files, &device.name, device.memory.flash_size)
            {
                match flash_algo::extract_flash_algorithm_from_flm(
                    &flm_path,
                    device.memory.flash_start,
                    device.memory.flash_size,
                ) {
                    Ok(mut algo) => {
                        device_algorithms.insert(
                            device.name.clone(),
                            crate::pack::scan_report::AlgorithmInfo {
                                name: algo.name.clone(),
                                flm_file: flm_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                                page_size: algo.flash_properties.page_size as u32,
                                sector_count: algo.flash_properties.sectors.len(),
                            },
                        );

                        // 算法名称包含 Flash 大小，避免不同大小的设备共享错误的扇区配置
                        let flash_size_kb = device.memory.flash_size / 1024;
                        let algo_key = format!("{}_{}", algo.name, flash_size_kb);
                        algo.name = algo_key.clone();

                        device_algo_map.insert(device.name.clone(), algo_key.clone());

                        // 只保存第一个遇到的同名+同大小算法
                        algo_map.entry(algo_key).or_insert(CollectedAlgo {
                            algo,
                            load_address: device.memory.ram_start,
                        });
                    }
                    Err(e) => {
                        log::warn!("提取 Flash 算法失败: {}，设备 {} 将无法烧录", e, device.name);
                    }
                }
            } else {
                log::warn!("未找到设备 {} 的 FLM 文件", device.name);
            }
        }
    }

    // 报告算法匹配完成
    if let Some(callback) = progress_callback {
        callback(PackScanProgress::new(
            ScanPhase::GeneratingYaml,
            0,
            1,
            format!("开始生成 YAML 配置，共 {} 个算法", algo_map.len()),
        ));
    }

    // 开始生成 YAML
    let mut yaml = String::new();

    // 版本标记（用于检测旧版本配置）
    yaml.push_str(&format!(
        "# MICU-OmniProbe Pack Scanner Version: {}\n",
        PACK_SCANNER_VERSION
    ));
    yaml.push_str(&format!(
        "# Generated at: {}\n\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    ));

    // 家族定义
    yaml.push_str(&format!("name: {}\n", yaml_str(family_name)));
    yaml.push_str("manufacturer:\n");
    yaml.push_str("  id: 0x0\n");
    yaml.push_str("  cc: 0x0\n");
    yaml.push_str("generated_from_pack: true\n");
    yaml.push_str("pack_file_release: \"unknown\"\n");

    // 在家族级别输出所有 flash 算法定义
    if !algo_map.is_empty() {
        yaml.push_str("flash_algorithms:\n");

        for collected in algo_map.values() {
            let algo = &collected.algo;
            yaml.push_str(&format!("  - name: {}\n", yaml_str(&algo.name)));
            yaml.push_str(&format!("    description: {}\n", yaml_str(&algo.description)));
            yaml.push_str("    default: true\n");
            // load_address 需要预留空间给 flash loader header
            // probe-rs 会在 load_address 之前分配 header 空间
            // 预留 0x20 (32 字节) 给 header
            let adjusted_load_address = collected.load_address.saturating_add(0x20);
            yaml.push_str(&format!("    load_address: 0x{:x}\n", adjusted_load_address));
            yaml.push_str(&format!("    data_section_offset: 0x{:x}\n", algo.data_section_offset));
            yaml.push_str("    transfer_encoding: raw\n");

            // 函数指针
            if let Some(pc_init) = algo.pc_init {
                yaml.push_str(&format!("    pc_init: 0x{:x}\n", pc_init));
            }
            if let Some(pc_uninit) = algo.pc_uninit {
                yaml.push_str(&format!("    pc_uninit: 0x{:x}\n", pc_uninit));
            }
            yaml.push_str(&format!("    pc_program_page: 0x{:x}\n", algo.pc_program_page));
            yaml.push_str(&format!("    pc_erase_sector: 0x{:x}\n", algo.pc_erase_sector));
            if let Some(pc_erase_all) = algo.pc_erase_all {
                yaml.push_str(&format!("    pc_erase_all: 0x{:x}\n", pc_erase_all));
            }

            // Flash 属性
            yaml.push_str("    flash_properties:\n");
            yaml.push_str("      address_range:\n");
            yaml.push_str(&format!(
                "        start: 0x{:x}\n",
                algo.flash_properties.address_range.start
            ));
            yaml.push_str(&format!(
                "        end: 0x{:x}\n",
                algo.flash_properties.address_range.end
            ));
            yaml.push_str(&format!("      page_size: {}\n", algo.flash_properties.page_size));
            yaml.push_str(&format!(
                "      erased_byte_value: 0x{:x}\n",
                algo.flash_properties.erased_byte_value
            ));
            yaml.push_str(&format!(
                "      program_page_timeout: {}\n",
                algo.flash_properties.program_page_timeout
            ));
            yaml.push_str(&format!(
                "      erase_sector_timeout: {}\n",
                algo.flash_properties.erase_sector_timeout
            ));

            // 扇区信息
            yaml.push_str("      sectors:\n");
            for sector in &algo.flash_properties.sectors {
                yaml.push_str(&format!("        - size: {}\n", sector.size));
                yaml.push_str(&format!("          address: 0x{:x}\n", sector.address));
            }

            // Instructions (base64 编码)
            yaml.push_str(&format!("    instructions: {}\n", yaml_str(&algo.instructions)));

            log::info!("生成家族级 Flash 算法: {}", algo.name);
        }
    }

    // 第二遍：生成 variants
    yaml.push_str("variants:\n");

    for device in devices {
        // 地址范围来自 PDSC，超出 64 位地址空间说明描述有误，跳过该设备
        let (Some(ram_end), Some(flash_end)) = (
            device.memory.ram_start.checked_add(device.memory.ram_size),
            device.memory.flash_start.checked_add(device.memory.flash_size),
        ) else {
            log::warn!("设备 {} 的内存范围超出地址空间，已跳过", device.name);
            continue;
        };

        yaml.push_str(&format!("  - name: {}\n", yaml_str(&device.name)));

        // 内存映射
        yaml.push_str("    memory_map:\n");

        // RAM
        if device.memory.ram_size > 0 {
            yaml.push_str("      - !Ram\n");
            yaml.push_str("        range:\n");
            yaml.push_str(&format!("          start: 0x{:x}\n", device.memory.ram_start));
            yaml.push_str(&format!("          end: 0x{:x}\n", ram_end));
            yaml.push_str("        cores:\n");
            yaml.push_str("          - main\n");
        }

        // Flash
        if device.memory.flash_size > 0 {
            yaml.push_str("      - !Nvm\n");
            yaml.push_str("        range:\n");
            yaml.push_str(&format!("          start: 0x{:x}\n", device.memory.flash_start));
            yaml.push_str(&format!("          end: 0x{:x}\n", flash_end));
            yaml.push_str("        cores:\n");
            yaml.push_str("          - main\n");
        }

        // 处理器核心
        yaml.push_str("    cores:\n");
        yaml.push_str("      - name: main\n");
        yaml.push_str(&format!("        type: {}\n", map_core_type(&device.processor.core)));
        yaml.push_str("        core_access_options: !Arm\n");
        yaml.push_str("          ap: !v1 0\n");

        // Flash 算法引用（只输出算法名称）
        if let Some(algo_name) = device_algo_map.get(&device.name) {
            yaml.push_str("    flash_algorithms:\n");
            yaml.push_str(&format!("      - {}\n", yaml_str(algo_name)));
        }

        yaml.push('\n');
    }

    // 报告完成
    if let Some(callback) = progress_callback {
        callback(PackScanProgress::new(
            ScanPhase::Complete,
            1,
            1,
            "YAML 配置生成完成".to_string(),
        ));
    }

    Ok(GeneratedTargets {
        yaml,
        device_algorithms,
    })
}

/// 映射处理器核心类型到 probe-rs 格式
fn map_core_type(core: &str) -> &'static str {
    match core.trim().to_uppercase().as_str() {
        "CORTEX-M0" | "CM0" | "CORTEX-M0+" | "CM0PLUS" | "CM0+" | "CORTEX-M1" | "CM1" | "SC000" => "armv6m",
        "CORTEX-M3" | "CM3" | "SC300" => "armv7m",
        "CORTEX-M4" | "CM4" | "CORTEX-M7" | "CM7" => "armv7em",
        "CORTEX-M23" | "CM23" | "CORTEX-M33" | "CM33" | "CORTEX-M35P" | "CM35P" | "CORTEX-M52" | "CM52"
        | "CORTEX-M55" | "CM55" | "CORTEX-M85" | "CM85" | "ARMV8MBL" | "ARMV8MML" | "ARMV81MML" => "armv8m",
        other => {
            log::warn!("未知的处理器核心类型 {:?}，按 ARMv7E-M 处理", other);
            "armv7em"
        }
    }
}

/// 生成扫描报告（算法匹配结果来自 [`generate_probe_rs_yaml_with_algo`]）
pub fn generate_scan_report(
    devices: &[DeviceDefinition],
    pack_name: &str,
    device_algorithms: &std::collections::HashMap<String, crate::pack::scan_report::AlgorithmInfo>,
) -> crate::pack::scan_report::PackScanReport {
    use crate::pack::scan_report::{DeviceReport, DeviceStatus, PackScanReport};

    let mut report = PackScanReport::new(pack_name.to_string());

    for device in devices {
        let algorithm = device_algorithms.get(&device.name).cloned();
        // 有 Flash 却没匹配到算法的设备无法烧录；没有 Flash 的设备（如纯 RAM 设备）正常
        let status = if device.memory.flash_size > 0 && algorithm.is_none() {
            DeviceStatus::Warning
        } else {
            DeviceStatus::Ok
        };
        report.add_device(DeviceReport {
            name: device.name.clone(),
            core: device.processor.core.clone(),
            flash_start: device.memory.flash_start,
            flash_size: device.memory.flash_size,
            ram_start: device.memory.ram_start,
            ram_size: device.memory.ram_size,
            algorithm,
            status,
        });
    }

    // 计算算法统计
    report.calculate_algorithm_stats();
    report
}

/// 保存扫描报告到文件
pub fn save_scan_report(report: &crate::pack::scan_report::PackScanReport, pack_dir: &Path) -> AppResult<()> {
    let report_path = pack_dir.join("scan_report.json");
    let json =
        serde_json::to_string_pretty(report).map_err(|e| AppError::PackError(format!("序列化报告失败: {}", e)))?;

    std::fs::write(&report_path, json).map_err(|e| AppError::FileError(format!("保存报告失败: {}", e)))?;

    log::info!("扫描报告已保存到: {:?}", report_path);
    Ok(())
}

/// 加载扫描报告
pub fn load_scan_report(pack_dir: &Path) -> AppResult<crate::pack::scan_report::PackScanReport> {
    let report_path = pack_dir.join("scan_report.json");

    if !report_path.exists() {
        return Err(AppError::FileError("扫描报告不存在".to_string()));
    }

    let json =
        std::fs::read_to_string(&report_path).map_err(|e| AppError::FileError(format!("读取报告失败: {}", e)))?;

    let report = serde_json::from_str(&json).map_err(|e| AppError::PackError(format!("解析报告失败: {}", e)))?;

    Ok(report)
}

/// 检测 Pack 的扫描器版本
/// 返回 None 表示无法检测版本（可能是旧版本）
pub fn detect_pack_scanner_version(pack_dir: &Path) -> Option<String> {
    let yaml_path = pack_dir.join("targets.yaml");

    if !yaml_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&yaml_path).ok()?;

    // 查找版本标记行
    for line in content.lines() {
        // 兼容更名前（EK-OmniProbe）生成的缓存，避免升级后全部 Pack 重新扫描
        let marker = line
            .strip_prefix("# MICU-OmniProbe Pack Scanner Version:")
            .or_else(|| line.strip_prefix("# EK-OmniProbe Pack Scanner Version:"));
        if let Some(version) = marker {
            return Some(version.trim().to_string());
        }
    }

    None
}

/// 检查 Pack 是否需要重新扫描
pub fn needs_rescan(pack_dir: &Path) -> bool {
    match detect_pack_scanner_version(pack_dir) {
        Some(version) => {
            // 比较版本号
            version != PACK_SCANNER_VERSION
        }
        None => {
            // 无法检测版本，可能是旧版本，需要重新扫描
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_and_decimal_numbers() {
        assert_eq!(parse_hex_or_dec("0x08000000"), Some(0x0800_0000));
        assert_eq!(parse_hex_or_dec(" 0X1f "), Some(0x1f));
        assert_eq!(parse_hex_or_dec("65536"), Some(65536));
        assert_eq!(parse_hex_or_dec("0xZZ"), None);
        assert_eq!(parse_hex_or_dec(""), None);
    }

    #[test]
    fn maps_cortex_m_cores() {
        assert_eq!(map_core_type("Cortex-M0+"), "armv6m");
        assert_eq!(map_core_type("Cortex-M3"), "armv7m");
        assert_eq!(map_core_type("Cortex-M4"), "armv7em");
        assert_eq!(map_core_type("Cortex-M23"), "armv8m");
        assert_eq!(map_core_type("Cortex-M33"), "armv8m");
        assert_eq!(map_core_type("Cortex-M55"), "armv8m");
        assert_eq!(map_core_type("Cortex-M85"), "armv8m");
    }

    fn device(name: &str, ram_start: u64, ram_size: u64) -> DeviceDefinition {
        DeviceDefinition {
            name: name.to_string(),
            processor: ProcessorInfo {
                core: "Cortex-M4".to_string(),
                fpu: true,
                mpu: true,
            },
            memory: MemoryInfo {
                ram_start,
                ram_size,
                flash_start: 0x0800_0000,
                flash_size: 0x1_0000,
            },
            flash_algorithm: None,
        }
    }

    #[test]
    fn yaml_escapes_untrusted_names_and_skips_overflowing_devices() {
        let pack_dir = std::env::temp_dir().join(format!("micu-target-gen-{}", std::process::id()));
        std::fs::create_dir_all(&pack_dir).unwrap();
        // 生成器要求 Pack 里至少有一个 FLM；内容无效时只会跳过算法，不影响设备定义
        std::fs::write(pack_dir.join("dummy.flm"), b"not an elf").unwrap();

        let devices = vec![
            device("EVIL: #chip\n  - name: injected", 0x2000_0000, 0x1000),
            device("OVERFLOW", u64::MAX, 0x10),
        ];
        let generated = generate_probe_rs_yaml_with_algo(&devices, "Family: x", &pack_dir, None).unwrap();
        let _ = std::fs::remove_dir_all(&pack_dir);

        let mut registry = probe_rs::config::Registry::new();
        registry.add_target_family_from_yaml(&generated.yaml).unwrap();
        let names = registry.families()[0]
            .variants()
            .iter()
            .map(|v| v.name.clone())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["EVIL: #chip\n  - name: injected".to_string()]);
    }

    #[test]
    fn scan_report_warns_for_flash_devices_without_algorithm() {
        let report = generate_scan_report(&[device("A", 0x2000_0000, 0x1000)], "pack", &Default::default());
        assert_eq!(report.devices_without_algo, 1);
    }
}
