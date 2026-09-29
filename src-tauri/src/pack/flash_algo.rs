// Flash 算法提取模块
// 从 .FLM 文件（ELF 格式）中提取 Flash 算法
// 参考 probe-rs/target-gen 的实现

use crate::error::{AppError, AppResult};
use base64::Engine;
use object::{Object, ObjectSection, ObjectSymbol};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Flash 算法定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashAlgorithm {
    pub name: String,
    pub description: String,
    pub default: bool,
    pub instructions: String,      // base64 编码的二进制 blob
    pub pc_init: Option<u64>,      // Init 函数地址（相对偏移）
    pub pc_uninit: Option<u64>,    // UnInit 函数地址（相对偏移）
    pub pc_program_page: u64,      // ProgramPage 函数地址（相对偏移）
    pub pc_erase_sector: u64,      // EraseSector 函数地址（相对偏移）
    pub pc_erase_all: Option<u64>, // EraseChip 函数地址（相对偏移）
    pub data_section_offset: u64,
    pub flash_properties: FlashProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashProperties {
    pub address_range: AddressRange,
    pub page_size: u64,
    pub erased_byte_value: u8,
    pub program_page_timeout: u64,
    pub erase_sector_timeout: u64,
    pub sectors: Vec<SectorInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectorInfo {
    pub size: u64,
    pub address: u64,
}

/// FlashDevice 结构（从 ELF 中的 FlashDevice 符号解析）
/// 参考 CMSIS 标准: https://arm-software.github.io/CMSIS_5/Pack/html/algorithmFunc.html
#[derive(Debug, Default)]
#[allow(dead_code)]
struct FlashDevice {
    pub name: String,
    pub start_address: u32,
    pub device_size: u32,
    pub page_size: u32,
    pub erased_default_value: u8,
    pub program_page_timeout: u32,
    pub erase_sector_timeout: u32,
    pub sectors: Vec<FlashSector>,
}

#[derive(Debug, Clone)]
struct FlashSector {
    pub size: u32,
    pub address: u32,
}

impl FlashDevice {
    /// 从 ELF 数据中解析 FlashDevice 结构
    /// FlashDevice 结构布局（CMSIS 标准）:
    /// - 0x00: u16 driver_version
    /// - 0x02: char[128] device_name
    /// - 0x82: u16 device_type
    /// - 0x84: u32 start_address
    /// - 0x88: u32 device_size
    /// - 0x8C: u32 page_size
    /// - 0x90: u32 reserved
    /// - 0x94: u8 erased_default_value
    /// - 0x95: u8[3] padding
    /// - 0x98: u32 program_page_timeout
    /// - 0x9C: u32 erase_sector_timeout
    /// - 0xA0: FlashSector[] sectors (each 8 bytes: size, address)
    fn from_elf_data(data: &[u8]) -> Option<Self> {
        if data.len() < 0xA0 {
            log::warn!("FlashDevice 数据太短: {} bytes", data.len());
            return None;
        }

        // 读取设备名称（偏移 0x02，最多 128 字节，null 结尾）
        let name_bytes = &data[0x02..0x82];
        let name_end = name_bytes.iter().position(|&b| b == 0).unwrap_or(128);
        let name = String::from_utf8_lossy(&name_bytes[..name_end]).to_string();

        // 读取其他字段（小端序）
        let start_address = u32::from_le_bytes([data[0x84], data[0x85], data[0x86], data[0x87]]);
        let device_size = u32::from_le_bytes([data[0x88], data[0x89], data[0x8A], data[0x8B]]);
        let page_size = u32::from_le_bytes([data[0x8C], data[0x8D], data[0x8E], data[0x8F]]);
        let erased_default_value = data[0x94];
        let program_page_timeout = u32::from_le_bytes([data[0x98], data[0x99], data[0x9A], data[0x9B]]);
        let erase_sector_timeout = u32::from_le_bytes([data[0x9C], data[0x9D], data[0x9E], data[0x9F]]);

        // 解析扇区信息（从 0xA0 开始，每个扇区 8 字节）
        let mut sectors = Vec::new();
        let mut offset = 0xA0;
        while offset + 8 <= data.len() {
            let sector_size = u32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
            let sector_addr =
                u32::from_le_bytes([data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]]);

            // 扇区列表以 0xFFFFFFFF 结尾
            if sector_size == 0xFFFFFFFF {
                break;
            }

            // 有效扇区
            if sector_size > 0 {
                sectors.push(FlashSector {
                    size: sector_size,
                    address: sector_addr,
                });
            }

            offset += 8;
        }

        log::info!(
            "解析 FlashDevice: name={}, start=0x{:08X}, size=0x{:X}, page_size={}, sectors={}",
            name,
            start_address,
            device_size,
            page_size,
            sectors.len()
        );

        Some(FlashDevice {
            name,
            start_address,
            device_size,
            page_size,
            erased_default_value,
            program_page_timeout,
            erase_sector_timeout,
            sectors,
        })
    }
}

/// 从 .FLM 文件提取 Flash 算法
pub fn extract_flash_algorithm_from_flm(
    flm_path: &Path,
    flash_start: u64,
    flash_size: u64,
) -> AppResult<FlashAlgorithm> {
    // 读取 FLM 文件
    let flm_data = fs::read(flm_path)?;

    // 解析 ELF 文件
    let elf_file =
        object::File::parse(&*flm_data).map_err(|e| AppError::PackError(format!("解析 FLM 文件失败: {}", e)))?;

    // 1. 查找 FlashDevice 符号并提取配置信息
    let flash_device = extract_flash_device(&elf_file, &flm_data);

    // 2. 提取 PrgCode 和 PrgData 段
    let (blob, code_start, data_offset) = extract_algorithm_blob(&elf_file)?;

    // 3. 提取函数符号地址（相对于代码段起始的偏移）
    let symbols = extract_function_symbols(&elf_file, code_start)?;

    // 4. 将二进制数据转换为 base64
    let instructions = base64::engine::general_purpose::STANDARD.encode(&blob);

    // 5. 构建扇区信息
    let sectors = if let Some(ref fd) = flash_device {
        // 从 FlashDevice 中获取扇区信息
        build_sectors_from_flash_device(fd, flash_start)
    } else {
        // 回退：生成默认扇区
        generate_default_sectors(flash_size)
    };

    // 6. 获取 page_size 和超时设置
    let (page_size, program_timeout, erase_timeout, erased_value) = if let Some(ref fd) = flash_device {
        (
            fd.page_size as u64,
            fd.program_page_timeout as u64,
            fd.erase_sector_timeout as u64,
            fd.erased_default_value,
        )
    } else {
        (256, 1000, 2000, 0xFF)
    };

    let algo_name = flm_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    log::info!(
        "提取 Flash 算法: {} (blob size: {}, data_offset: 0x{:X})",
        algo_name,
        blob.len(),
        data_offset
    );

    Ok(FlashAlgorithm {
        name: algo_name,
        description: "Flash algorithm from CMSIS-Pack".to_string(),
        default: true,
        instructions,
        pc_init: symbols.get("Init").copied(),
        pc_uninit: symbols.get("UnInit").copied(),
        pc_program_page: *symbols
            .get("ProgramPage")
            .ok_or_else(|| AppError::PackError("未找到 ProgramPage 函数".to_string()))?,
        pc_erase_sector: *symbols
            .get("EraseSector")
            .ok_or_else(|| AppError::PackError("未找到 EraseSector 函数".to_string()))?,
        pc_erase_all: symbols.get("EraseChip").copied(),
        data_section_offset: data_offset,
        flash_properties: FlashProperties {
            address_range: AddressRange {
                start: flash_start,
                end: flash_start + flash_size,
            },
            page_size,
            erased_byte_value: erased_value,
            program_page_timeout: program_timeout,
            erase_sector_timeout: erase_timeout,
            sectors,
        },
    })
}

/// 从 ELF 中提取 FlashDevice 符号的数据
fn extract_flash_device(elf_file: &object::File, _raw_data: &[u8]) -> Option<FlashDevice> {
    for symbol in elf_file.symbols() {
        if let Ok(name) = symbol.name() {
            if name == "FlashDevice" {
                let addr = symbol.address() as usize;
                let size = symbol.size() as usize;

                // 查找包含该符号的段
                for section in elf_file.sections() {
                    let section_addr = section.address() as usize;
                    let section_size = section.size() as usize;

                    if addr >= section_addr && addr < section_addr + section_size {
                        if let Ok(section_data) = section.data() {
                            let offset_in_section = addr - section_addr;
                            let end = (offset_in_section + size).min(section_data.len());

                            if offset_in_section < section_data.len() {
                                let device_data = &section_data[offset_in_section..end];
                                return FlashDevice::from_elf_data(device_data);
                            }
                        }
                    }
                }

                // 如果在段中找不到，尝试直接从文件偏移读取
                // （某些 ELF 文件的布局可能不同）
                log::warn!("无法从段中提取 FlashDevice，尝试其他方法");
            }
        }
    }

    log::warn!("未找到 FlashDevice 符号");
    None
}

/// 提取算法二进制 blob（PrgCode + PrgData + BSS 填充）
fn extract_algorithm_blob(elf_file: &object::File) -> AppResult<(Vec<u8>, u64, u64)> {
    let mut code_section: Option<(u64, Vec<u8>)> = None;
    let mut data_section: Option<(u64, Vec<u8>)> = None;
    let mut bss_size: u64 = 0;

    // 查找 PrgCode、PrgData 段（CMSIS 标准段名）
    for section in elf_file.sections() {
        let name = section.name().unwrap_or("");

        match name {
            "PrgCode" => {
                if let Ok(data) = section.data() {
                    code_section = Some((section.address(), data.to_vec()));
                    log::info!("找到 PrgCode 段: addr=0x{:X}, size={}", section.address(), data.len());
                }
            }
            "PrgData" => {
                if section.kind() == object::SectionKind::UninitializedData {
                    // BSS 段（未初始化数据）
                    bss_size = section.size();
                    log::info!("找到 PrgData BSS 段: size={}", bss_size);
                } else if let Ok(data) = section.data() {
                    // 初始化数据段
                    data_section = Some((section.address(), data.to_vec()));
                    log::info!("找到 PrgData 段: addr=0x{:X}, size={}", section.address(), data.len());
                }
            }
            _ => {}
        }
    }

    // 如果没找到 CMSIS 标准段名，回退到通用段
    if code_section.is_none() {
        log::info!("未找到 PrgCode 段，尝试使用 .text 段");
        for section in elf_file.sections() {
            if section.kind() == object::SectionKind::Text {
                if let Ok(data) = section.data() {
                    if !data.is_empty() {
                        code_section = Some((section.address(), data.to_vec()));
                        log::info!("使用 .text 段: addr=0x{:X}, size={}", section.address(), data.len());
                        break;
                    }
                }
            }
        }
    }

    if data_section.is_none() {
        log::info!("未找到 PrgData 段，尝试使用 .data 段");
        for section in elf_file.sections() {
            if section.kind() == object::SectionKind::Data {
                if let Ok(data) = section.data() {
                    if !data.is_empty() {
                        data_section = Some((section.address(), data.to_vec()));
                        log::info!("使用 .data 段: addr=0x{:X}, size={}", section.address(), data.len());
                        break;
                    }
                }
            }
        }
    }

    let (code_start, code_data) = code_section.ok_or_else(|| AppError::PackError("未找到代码段".to_string()))?;

    assemble_algorithm_blob(code_start, code_data, data_section, bss_size)
}

/// Flash 算法要整体装进目标 RAM 运行，正常只有几 KB 到几十 KB；
/// 超过上限说明 FLM 头信息异常，直接拒绝，避免巨量分配让进程 abort。
const MAX_ALGORITHM_BLOB_SIZE: u64 = 1024 * 1024;

/// 构建连续的二进制 blob（代码段 + 间隙填充 + 数据段 + BSS），返回 (blob, code_start, data_offset)
fn assemble_algorithm_blob(
    code_start: u64,
    code_data: Vec<u8>,
    data_section: Option<(u64, Vec<u8>)>,
    bss_size: u64,
) -> AppResult<(Vec<u8>, u64, u64)> {
    let too_large = || {
        AppError::PackError(format!(
            "Flash 算法超过 {} 字节，FLM 文件可能已损坏",
            MAX_ALGORITHM_BLOB_SIZE
        ))
    };

    let mut blob = code_data;
    let (data_offset, data_bytes) = match data_section {
        Some((data_addr, data_bytes)) => {
            // 计算数据段相对于代码段起始的偏移
            let offset = data_addr
                .checked_sub(code_start)
                .ok_or_else(|| AppError::PackError("数据段地址位于代码段之前".to_string()))?;
            if offset < blob.len() as u64 {
                return Err(AppError::PackError("数据段与代码段重叠".to_string()));
            }
            (offset, data_bytes)
        }
        None => (blob.len() as u64, Vec::new()),
    };

    let total = data_offset
        .checked_add(data_bytes.len() as u64)
        .and_then(|v| v.checked_add(bss_size))
        .ok_or_else(too_large)?;
    if total > MAX_ALGORITHM_BLOB_SIZE {
        return Err(too_large());
    }

    // 数据段不紧跟代码段时填充间隙，最后补 BSS 零填充
    blob.resize(data_offset as usize, 0);
    blob.extend(data_bytes);
    blob.resize(total as usize, 0);

    Ok((blob, code_start, data_offset))
}

/// 提取函数符号地址（相对于代码段起始的偏移）
fn extract_function_symbols(
    elf_file: &object::File,
    code_start: u64,
) -> AppResult<std::collections::HashMap<String, u64>> {
    let mut symbols = std::collections::HashMap::new();

    for symbol in elf_file.symbols() {
        if let Ok(name) = symbol.name() {
            // 只保留我们需要的函数
            if matches!(name, "Init" | "UnInit" | "ProgramPage" | "EraseSector" | "EraseChip") {
                // 计算相对于代码段起始的偏移
                let offset = symbol.address().saturating_sub(code_start);

                // Thumb 模式需要设置最低位为 1
                let thumb_offset = offset | 1;

                symbols.insert(name.to_string(), thumb_offset);
                log::info!(
                    "函数 {}: addr=0x{:X}, offset=0x{:X}",
                    name,
                    symbol.address(),
                    thumb_offset
                );
            }
        }
    }

    Ok(symbols)
}

/// 从 FlashDevice 构建扇区信息
/// 注意：probe-rs 期望扇区地址是相对于 flash 起始地址的偏移量，第一个扇区地址必须为 0
fn build_sectors_from_flash_device(fd: &FlashDevice, _flash_start: u64) -> Vec<SectorInfo> {
    if fd.sectors.is_empty() {
        return generate_default_sectors(fd.device_size as u64);
    }

    let mut sectors = Vec::new();

    // FlashDevice 中的扇区描述是"扇区大小+该大小扇区的起始地址"
    // 需要展开为完整的扇区列表
    // 扇区地址使用相对偏移量（从 0 开始），不是绝对地址
    for (i, sector_desc) in fd.sectors.iter().enumerate() {
        let sector_size = sector_desc.size as u64;
        let region_start = sector_desc.address as u64;

        // 计算下一个扇区区域的起始地址
        let region_end = if i + 1 < fd.sectors.len() {
            fd.sectors[i + 1].address as u64
        } else {
            fd.device_size as u64
        };

        // 生成该区域内的所有扇区（使用相对地址）
        let mut addr = region_start;
        while addr < region_end {
            sectors.push(SectorInfo {
                size: sector_size,
                address: addr, // 相对地址，不加 flash_start
            });
            addr += sector_size;
        }
    }

    if sectors.is_empty() {
        generate_default_sectors(fd.device_size as u64)
    } else {
        sectors
    }
}

/// 生成默认扇区信息（4KB 扇区）
/// 扇区地址使用相对偏移量（从 0 开始）
fn generate_default_sectors(flash_size: u64) -> Vec<SectorInfo> {
    let sector_size = 4096u64;
    let sector_count = flash_size.div_ceil(sector_size);

    (0..sector_count)
        .map(|i| SectorInfo {
            size: sector_size,
            address: i * sector_size, // 相对地址，从 0 开始
        })
        .collect()
}

/// 从 Pack 目录查找 FLM 文件
pub fn find_flm_files(pack_dir: &Path) -> AppResult<Vec<std::path::PathBuf>> {
    let mut flm_files = Vec::new();

    fn search_dir(dir: &Path, flm_files: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();

                if path.is_dir() {
                    search_dir(&path, flm_files)?;
                } else if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("flm") || ext.eq_ignore_ascii_case("FLM"))
                {
                    flm_files.push(path);
                }
            }
        }
        Ok(())
    }

    search_dir(pack_dir, &mut flm_files)?;

    if flm_files.is_empty() {
        return Err(AppError::PackError("Pack 中未找到 FLM 文件".to_string()));
    }

    Ok(flm_files)
}

/// 根据设备名称和 Flash 大小匹配 FLM 文件
pub fn match_flm_for_device(
    flm_files: &[std::path::PathBuf],
    device_name: &str,
    flash_size: u64,
) -> Option<std::path::PathBuf> {
    let device_upper = device_name.to_uppercase();
    let flash_size_kb = flash_size / 1024;
    let flash_size_mb = flash_size / (1024 * 1024);

    log::info!(
        "匹配 FLM: 设备={}, Flash={}KB, 可用FLM数={}",
        device_name,
        flash_size_kb,
        flm_files.len()
    );

    // 1. 精确匹配设备型号（Flash + 设备名）
    for flm_path in flm_files {
        if let Some(file_name) = flm_path.file_name().and_then(|s| s.to_str()) {
            let stem = file_name.to_uppercase().trim_end_matches(".FLM").to_string();
            // 移除常见前缀 "FLASH" 进行比较
            let stem_clean = stem.trim_start_matches("FLASH");
            if stem == device_upper || stem_clean == device_upper {
                log::info!("精确匹配 FLM: {} -> {}", device_name, file_name);
                return Some(flm_path.clone());
            }
        }
    }

    // 2. 提取设备系列（如 CW32L010F8 -> CW32L010）
    // 去除末尾的封装后缀（如 F8, C8, R8 等）
    let device_series = extract_device_series(&device_upper);
    log::info!("设备系列: {}", device_series);

    // 3. 尝试匹配 Flash+设备系列
    for flm_path in flm_files {
        if let Some(file_name) = flm_path.file_name().and_then(|s| s.to_str()) {
            let file_name_upper = file_name.to_uppercase();
            let stem = file_name_upper.trim_end_matches(".FLM");
            let stem_clean = stem.trim_start_matches("FLASH");

            if stem_clean == device_series {
                log::info!("系列匹配 FLM: {} ({}) -> {}", device_name, device_series, file_name);
                return Some(flm_path.clone());
            }
        }
    }

    // 4. 按 Flash 大小匹配
    let size_patterns: Vec<String> = if flash_size_mb >= 1 {
        vec![format!("_{}MB", flash_size_mb), format!("{}MB", flash_size_mb)]
    } else {
        vec![
            format!("_{}KB", flash_size_kb),
            format!("{}KB", flash_size_kb),
            format!("_{}K", flash_size_kb),
        ]
    };

    // 提取短前缀用于系列匹配
    let series_prefix = if device_upper.starts_with("GD32") || device_upper.starts_with("STM32") {
        device_upper.chars().take(6).collect::<String>()
    } else if device_upper.starts_with("CW32") {
        device_upper.chars().take(7).collect::<String>() // CW32L01, CW32F03 等
    } else {
        device_upper.chars().take(4).collect::<String>()
    };

    for flm_path in flm_files {
        if let Some(file_name) = flm_path.file_name().and_then(|s| s.to_str()) {
            let file_name_upper = file_name.to_uppercase();
            if file_name_upper.contains(&series_prefix) {
                for pattern in &size_patterns {
                    if file_name_upper.contains(&pattern.to_uppercase()) {
                        log::info!("按大小匹配 FLM: {} ({}KB) -> {}", device_name, flash_size_kb, file_name);
                        return Some(flm_path.clone());
                    }
                }
            }
        }
    }

    // 5. 模糊匹配（设备系列包含在 FLM 名称中，或 FLM 名称包含在设备系列中）
    for flm_path in flm_files {
        if let Some(file_name) = flm_path.file_name().and_then(|s| s.to_str()) {
            let file_name_upper = file_name.to_uppercase();
            let stem = file_name_upper.trim_end_matches(".FLM");
            let stem_clean = stem.trim_start_matches("FLASH");

            // 检查是否有交集
            if device_series.contains(stem_clean) || stem_clean.contains(&device_series) {
                let has_size_suffix = file_name_upper.contains("KB") || file_name_upper.contains("MB");
                if !has_size_suffix {
                    log::info!("模糊匹配 FLM: {} -> {}", device_name, file_name);
                    return Some(flm_path.clone());
                }
            }
        }
    }

    // 6. 最后尝试：匹配任何包含系列前缀且无大小后缀的 FLM
    for flm_path in flm_files {
        if let Some(file_name) = flm_path.file_name().and_then(|s| s.to_str()) {
            let file_name_upper = file_name.to_uppercase();
            if file_name_upper.contains(&series_prefix) {
                let has_size_suffix = file_name_upper.contains("KB") || file_name_upper.contains("MB");
                if !has_size_suffix {
                    log::info!("前缀匹配 FLM: {} -> {}", device_name, file_name);
                    return Some(flm_path.clone());
                }
            }
        }
    }

    log::warn!("未找到设备 {} (Flash: {}KB) 的匹配 FLM", device_name, flash_size_kb);
    None
}

/// 从设备名称提取系列名（去除封装后缀）
/// 例如: CW32L010F8 -> CW32L010, STM32F103C8Tx -> STM32F103
fn extract_device_series(device_name: &str) -> String {
    let name = device_name.to_uppercase();

    // CW32 系列: CW32L010F8 -> CW32L010
    if name.starts_with("CW32") {
        // 查找第一个数字序列后的字母
        let mut last_digit_pos = 0;
        for (i, c) in name.char_indices() {
            if c.is_ascii_digit() {
                last_digit_pos = i;
            }
        }
        // 返回到最后一个数字位置
        if last_digit_pos > 0 {
            return name[..=last_digit_pos].to_string();
        }
    }

    // GD32/STM32 系列: STM32F103C8Tx -> STM32F103
    if name.starts_with("GD32") || name.starts_with("STM32") {
        // 简化：取前 9 个字符作为系列名
        return name.chars().take(9.min(name.len())).collect();
    }

    // 默认：取前 8 个字符
    name.chars().take(8.min(name.len())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_code_padding_data_and_bss() {
        let (blob, start, offset) = assemble_algorithm_blob(0x20, vec![1, 2], Some((0x24, vec![3])), 2).unwrap();
        assert_eq!(start, 0x20);
        assert_eq!(offset, 4);
        assert_eq!(blob, vec![1, 2, 0, 0, 3, 0, 0]);
    }

    #[test]
    fn without_data_section_offset_follows_code() {
        let (blob, _, offset) = assemble_algorithm_blob(0, vec![1, 2, 3], None, 1).unwrap();
        assert_eq!(offset, 3);
        assert_eq!(blob, vec![1, 2, 3, 0]);
    }

    #[test]
    fn rejects_huge_padding_and_bss() {
        assert!(assemble_algorithm_blob(0, vec![0; 4], Some((0x2000_0000, vec![1])), 0).is_err());
        assert!(assemble_algorithm_blob(0, vec![0; 4], None, u64::MAX).is_err());
    }

    #[test]
    fn rejects_overlapping_or_preceding_data() {
        assert!(assemble_algorithm_blob(0, vec![0; 8], Some((4, vec![1])), 0).is_err());
        assert!(assemble_algorithm_blob(0x100, vec![0; 8], Some((0x10, vec![1])), 0).is_err());
    }
}
