use crate::commands::with_session;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use probe_rs::flashing::{
    download_file_with_options, erase, erase_all, BinOptions, DownloadOptions, ElfOptions, FlashProgress, Format,
    ProgressEvent, ProgressOperation,
};
use probe_rs::{MemoryInterface, Session};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::ipc::Response;
use tauri::{Emitter, State, Window};

/// 进度跟踪状态
#[derive(Debug)]
struct ProgressState {
    erase_total: u64,
    erase_current: u64,
    program_total: u64,
    program_current: u64,
}

impl ProgressState {
    fn new() -> Self {
        Self {
            erase_total: 0,
            erase_current: 0,
            program_total: 0,
            program_current: 0,
        }
    }

    /// 计算总体进度 (0.0 - 1.0)
    /// 擦除: 0-30%, 编程: 30-90%, 完成: 90-100%
    fn calculate_progress(&self) -> f32 {
        if self.program_total > 0 {
            // 编程阶段: 30% - 90%
            0.30 + (self.program_current as f32 / self.program_total as f32) * 0.60
        } else if self.erase_total > 0 {
            // 擦除阶段: 0% - 30%
            (self.erase_current as f32 / self.erase_total as f32) * 0.30
        } else {
            0.0
        }
    }
}

/// 擦除模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum EraseMode {
    #[default]
    ChipErase, // 整片擦除
    SectorErase, // 扇区擦除
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlashOptions {
    pub file_path: String,
    pub verify: bool,
    pub skip_erase: bool,
    pub reset_after: bool,
    #[serde(default)]
    pub erase_mode: EraseMode,
    // 自定义烧录地址（仅 BIN 格式使用）
    pub use_custom_address: Option<bool>,
    pub custom_flash_address: Option<u64>,
    // 预校验：烧录前检查，跳过已正确的块（加速重复烧录）
    #[serde(default)]
    pub preverify: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlashProgressEvent {
    pub phase: String,
    pub progress: f32,
    pub message: String,
}

#[tauri::command]
pub async fn flash_firmware(options: FlashOptions, state: State<'_, AppState>, window: Window) -> AppResult<()> {
    // 烧录可能持续数分钟，整段放到阻塞线程执行
    with_session(&state.session, move |session| {
        flash_firmware_blocking(session, options, window)
    })
    .await
}

/// 主 Flash（第一个非别名 NVM 区域）的起始地址，BIN 烧录与校验共用
fn default_flash_start(session: &Session) -> u64 {
    session
        .target()
        .memory_map
        .iter()
        .find_map(|region| match region {
            probe_rs::config::MemoryRegion::Nvm(r) if !r.is_alias => Some(r.range.start),
            _ => None,
        })
        .unwrap_or(0x08000000) // 默认STM32 Flash地址
}

fn flash_firmware_blocking(session: &mut Session, options: FlashOptions, window: Window) -> AppResult<()> {
    let path = Path::new(&options.file_path);
    if !path.exists() {
        return Err(AppError::FileError("文件不存在".to_string()));
    }

    // 根据文件扩展名确定格式
    // 支持的格式: ELF, HEX, BIN, AXF (ARM ELF), OUT
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase());
    let format = match ext.as_deref() {
        // Intel HEX 格式
        Some("hex") | Some("ihex") => {
            log::info!("检测到 HEX 格式固件");
            Format::Hex
        }
        // 纯二进制格式 - 需要指定基地址
        Some("bin") => {
            log::info!("检测到 BIN 格式固件");
            let base_address = if options.use_custom_address.unwrap_or(false) {
                options.custom_flash_address.unwrap_or(0x08000000)
            } else {
                // 自动从目标内存映射获取Flash起始地址
                default_flash_start(session)
            };
            log::info!("BIN 基地址: 0x{:08X}", base_address);
            Format::Bin(BinOptions {
                base_address: Some(base_address),
                skip: 0,
            })
        }
        // ELF 格式 (包括 AXF - ARM eXecutable Format)
        Some("elf") | Some("axf") | Some("out") => {
            log::info!("检测到 ELF 格式固件 (扩展名: {})", ext.as_deref().unwrap_or("unknown"));
            Format::Elf(ElfOptions::default())
        }
        // 未知扩展名 - 尝试作为 ELF 解析
        _ => {
            log::info!("未知扩展名 {:?}，尝试作为 ELF 格式解析", ext);
            Format::Elf(ElfOptions::default())
        }
    };

    // 根据擦除模式配置下载选项
    let mut download_options = DownloadOptions::default();
    if options.skip_erase {
        download_options.skip_erase = true;
    } else {
        match options.erase_mode {
            EraseMode::ChipErase => {
                download_options.do_chip_erase = true;
            }
            EraseMode::SectorErase => {
                download_options.do_chip_erase = false;
                // probe-rs 默认使用扇区擦除
            }
        }
    }
    download_options.verify = options.verify;
    download_options.preverify = options.preverify; // 预校验：跳过已正确的块

    // 创建并设置进度回调
    let progress_state = Arc::new(Mutex::new(ProgressState::new()));
    let window_clone = window.clone();
    let progress_state_clone = Arc::clone(&progress_state);

    let progress_callback = FlashProgress::new(move |event| {
        let mut state = progress_state_clone.lock();

        let (phase, message) = match event {
            ProgressEvent::FlashLayoutReady { .. } => ("init".to_string(), "Flash布局准备完成".to_string()),
            ProgressEvent::AddProgressBar { operation, total } => match operation {
                ProgressOperation::Erase => {
                    state.erase_total = total.unwrap_or(0);
                    ("init".to_string(), format!("准备擦除 {} 字节", state.erase_total))
                }
                ProgressOperation::Program => {
                    state.program_total = total.unwrap_or(0);
                    ("init".to_string(), format!("准备编程 {} 字节", state.program_total))
                }
                ProgressOperation::Fill => ("init".to_string(), "准备填充数据".to_string()),
                ProgressOperation::Verify => ("init".to_string(), "准备校验".to_string()),
            },
            ProgressEvent::Started(operation) => match operation {
                ProgressOperation::Fill => ("fill".to_string(), "开始填充数据".to_string()),
                ProgressOperation::Erase => {
                    state.erase_current = 0;
                    ("erase".to_string(), "开始擦除".to_string())
                }
                ProgressOperation::Program => {
                    state.program_current = 0;
                    ("program".to_string(), "开始编程".to_string())
                }
                ProgressOperation::Verify => ("verify".to_string(), "开始校验".to_string()),
            },
            ProgressEvent::Progress { operation, size, .. } => match operation {
                ProgressOperation::Fill => ("fill".to_string(), format!("已填充 {} 字节", size)),
                ProgressOperation::Erase => {
                    state.erase_current += size;
                    state.erase_total = state.erase_current.max(state.erase_total);
                    ("erase".to_string(), format!("已擦除 {} 字节", state.erase_current))
                }
                ProgressOperation::Program => {
                    state.program_current += size;
                    (
                        "program".to_string(),
                        format!("已编程 {}/{} 字节", state.program_current, state.program_total),
                    )
                }
                ProgressOperation::Verify => ("verify".to_string(), format!("已校验 {} 字节", size)),
            },
            ProgressEvent::Failed(operation) => match operation {
                ProgressOperation::Fill => ("fill".to_string(), "填充失败".to_string()),
                ProgressOperation::Erase => ("erase".to_string(), "擦除失败".to_string()),
                ProgressOperation::Program => ("program".to_string(), "编程失败".to_string()),
                ProgressOperation::Verify => ("verify".to_string(), "校验失败".to_string()),
            },
            ProgressEvent::Finished(operation) => match operation {
                ProgressOperation::Fill => ("fill".to_string(), "填充完成".to_string()),
                ProgressOperation::Erase => ("erase".to_string(), "擦除完成".to_string()),
                ProgressOperation::Program => ("program".to_string(), "编程完成".to_string()),
                ProgressOperation::Verify => ("verify".to_string(), "校验完成".to_string()),
            },
            ProgressEvent::DiagnosticMessage { message } => ("info".to_string(), message),
        };

        let progress = state.calculate_progress();

        let _ = window_clone.emit(
            "flash-progress",
            FlashProgressEvent {
                phase,
                progress,
                message,
            },
        );
    });

    download_options.progress = progress_callback;

    // 执行下载
    download_file_with_options(session, path, format, download_options).map_err(|e| {
        // 输出详细的错误信息用于调试
        log::error!("Flash 错误详情: {:?}", e);
        log::error!("Flash 错误类型: {}", std::any::type_name_of_val(&e));

        // 构建更详细的错误消息
        let error_msg = format!("{:#}", e);
        AppError::FlashError(error_msg)
    })?;

    // 烧录完成，发送 95% 进度
    let _ = window.emit(
        "flash-progress",
        FlashProgressEvent {
            phase: "finishing".to_string(),
            progress: 0.95,
            message: "烧录完成，正在收尾...".to_string(),
        },
    );

    // 重置芯片
    if options.reset_after {
        let _ = window.emit(
            "flash-progress",
            FlashProgressEvent {
                phase: "reset".to_string(),
                progress: 0.98,
                message: "正在复位芯片...".to_string(),
            },
        );
        let mut core = session.core(0).map_err(|e| AppError::FlashError(e.to_string()))?;
        core.reset().map_err(|e| AppError::FlashError(e.to_string()))?;
    }

    let _ = window.emit(
        "flash-progress",
        FlashProgressEvent {
            phase: "complete".to_string(),
            progress: 1.0,
            message: "烧录完成".to_string(),
        },
    );

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct EraseChipOptions {
    #[serde(default)]
    pub erase_mode: EraseMode,
}

#[tauri::command]
pub async fn erase_chip(
    options: Option<EraseChipOptions>,
    state: State<'_, AppState>,
    window: Window,
) -> AppResult<()> {
    let erase_mode = options.map(|o| o.erase_mode).unwrap_or(EraseMode::ChipErase);
    with_session(&state.session, move |session| {
        erase_chip_blocking(session, erase_mode, window)
    })
    .await
}

fn erase_chip_blocking(session: &mut Session, erase_mode: EraseMode, window: Window) -> AppResult<()> {
    match erase_mode {
        EraseMode::ChipErase => {
            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "erase".to_string(),
                    progress: 0.0,
                    message: "开始全片擦除".to_string(),
                },
            );

            let mut progress = FlashProgress::new(|_| {});
            erase_all(session, &mut progress, false).map_err(|e| AppError::FlashError(e.to_string()))?;

            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "complete".to_string(),
                    progress: 1.0,
                    message: "全片擦除完成".to_string(),
                },
            );
        }
        EraseMode::SectorErase => {
            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "erase".to_string(),
                    progress: 0.0,
                    message: "开始扇区擦除".to_string(),
                },
            );

            // 按扇区逐个擦除所有主 NVM 区域（别名区域指向同一块 Flash，跳过）。
            // 直接调用 probe-rs 的范围擦除，不再“写满 0xFF”：省掉一遍编程，也不用按区域大小分配内存。
            let flash_regions: Vec<_> = session
                .target()
                .memory_map
                .iter()
                .filter_map(|region| match region {
                    probe_rs::config::MemoryRegion::Nvm(r) if !r.is_alias => Some(r.range.clone()),
                    _ => None,
                })
                .collect();

            let mut progress = FlashProgress::new(|_| {});
            for range in flash_regions {
                erase(session, &mut progress, range.start, range.end, false)
                    .map_err(|e| AppError::FlashError(e.to_string()))?;
            }

            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "complete".to_string(),
                    progress: 1.0,
                    message: "扇区擦除完成".to_string(),
                },
            );
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct EraseSectorOptions {
    pub address: u64,
    pub size: u64,
}

#[tauri::command]
pub async fn erase_sector(options: EraseSectorOptions, state: State<'_, AppState>) -> AppResult<()> {
    // 64MB 上限校验，防止 OOM
    const MAX_ERASE_SIZE: u64 = 64 * 1024 * 1024;
    if options.size > MAX_ERASE_SIZE {
        return Err(AppError::InvalidInput(format!(
            "擦除大小 {} 字节超过最大限制 64MB",
            options.size
        )));
    }

    with_session(&state.session, move |session| {
        // 用 FlashLoader 写入 0xFF：覆盖到的扇区整体擦除，不要求地址按扇区对齐
        let mut loader = session.target().flash_loader();
        loader
            .add_data(options.address, &vec![0xFF; options.size as usize])
            .map_err(|e| AppError::FlashError(e.to_string()))?;
        loader
            .commit(session, DownloadOptions::default())
            .map_err(|e| AppError::FlashError(e.to_string()))
    })
    .await
}

#[tauri::command]
/// `address` 为 BIN 固件的起始地址，应与烧录时使用的地址一致；
/// 不传时使用主 Flash 起始地址（与烧录时未启用自定义地址的行为相同）。
pub async fn verify_firmware(
    file_path: String,
    address: Option<u64>,
    state: State<'_, AppState>,
    window: Window,
) -> AppResult<bool> {
    // 检测文件格式，只支持 BIN 格式
    {
        use std::io::Read as IoRead;
        let mut header = [0u8; 4];
        let mut f = std::fs::File::open(&file_path).map_err(|e| AppError::FileError(e.to_string()))?;
        let _ = f.read(&mut header);

        // ELF 魔数: 0x7F 'E' 'L' 'F'
        if header == [0x7F, 0x45, 0x4C, 0x46] {
            return Err(AppError::InvalidInput(
                "检测到 ELF 格式文件，verify_firmware 仅支持 BIN 格式，请先将固件转换为 BIN 文件。".to_string(),
            ));
        }
        // Intel HEX 以 ':' 开头
        if header[0] == b':' {
            return Err(AppError::InvalidInput(
                "检测到 Intel HEX 格式文件，verify_firmware 仅支持 BIN 格式，请先将固件转换为 BIN 文件。".to_string(),
            ));
        }
    }

    with_session(&state.session, move |session| {
        verify_firmware_blocking(session, file_path, address, window)
    })
    .await
}

fn verify_firmware_blocking(
    session: &mut Session,
    file_path: String,
    address: Option<u64>,
    window: Window,
) -> AppResult<bool> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::FileError("文件不存在".to_string()));
    }

    let _ = window.emit(
        "flash-progress",
        FlashProgressEvent {
            phase: "verify".to_string(),
            progress: 0.0,
            message: "开始校验".to_string(),
        },
    );

    // 读取文件
    let file_data = std::fs::read(path)?;
    let total_size = file_data.len();

    let flash_start = address.unwrap_or_else(|| default_flash_start(session));

    let mut core = session.core(0).map_err(|e| AppError::FlashError(e.to_string()))?;

    // 分块校验 - 每块 4KB，大幅提升速度
    const CHUNK_SIZE: usize = 4096;
    let mut verified: usize = 0;
    let mut flash_buffer = vec![0u8; CHUNK_SIZE];

    while verified < total_size {
        let chunk_len = std::cmp::min(CHUNK_SIZE, total_size - verified);
        let current_addr = flash_start + verified as u64;

        // 读取当前块
        core.read(current_addr, &mut flash_buffer[..chunk_len])
            .map_err(|e| AppError::FlashError(e.to_string()))?;

        // 比较当前块
        if flash_buffer[..chunk_len] != file_data[verified..verified + chunk_len] {
            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "error".to_string(),
                    progress: verified as f32 / total_size as f32,
                    message: format!("校验失败：地址 0x{:08X} 处数据不匹配", current_addr),
                },
            );
            return Ok(false);
        }

        verified += chunk_len;

        // 更新进度（每 64KB 更新一次，减少开销）
        if verified % (64 * 1024) < CHUNK_SIZE || verified >= total_size {
            let progress = verified as f32 / total_size as f32;
            let _ = window.emit(
                "flash-progress",
                FlashProgressEvent {
                    phase: "verify".to_string(),
                    progress,
                    message: format!("已校验 {}/{} 字节 ({:.1}%)", verified, total_size, progress * 100.0),
                },
            );
        }
    }

    let _ = window.emit(
        "flash-progress",
        FlashProgressEvent {
            phase: "complete".to_string(),
            progress: 1.0,
            message: format!("校验通过 ({} 字节)", total_size),
        },
    );

    Ok(true)
}

#[derive(Debug, Deserialize)]
pub struct ReadFlashOptions {
    pub address: u64,
    pub size: u64,
}

#[tauri::command]
pub async fn read_flash(options: ReadFlashOptions, state: State<'_, AppState>) -> AppResult<Response> {
    const MAX_FLASH_READ_SIZE: u64 = 64 * 1024 * 1024;
    if options.size > MAX_FLASH_READ_SIZE {
        return Err(AppError::InvalidInput(format!(
            "Flash 读取大小 {} 字节超过最大限制 64MB",
            options.size
        )));
    }

    let data = with_session(&state.session, move |session| {
        let mut core = session.core(0).map_err(|e| AppError::FlashError(e.to_string()))?;
        let mut data = vec![0u8; options.size as usize];
        core.read(options.address, &mut data)
            .map_err(|e| AppError::FlashError(e.to_string()))?;
        Ok(data)
    })
    .await?;

    Ok(Response::new(data))
}

/// 固件文件信息
#[derive(Debug, Clone, Serialize)]
pub struct FirmwareFileInfo {
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>, // Unix timestamp in seconds
    pub exists: bool,
}

/// 获取固件文件信息（用于烧录前重载）
#[tauri::command]
pub async fn get_firmware_info(file_path: String) -> AppResult<FirmwareFileInfo> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Ok(FirmwareFileInfo {
            path: file_path,
            size: 0,
            modified: None,
            exists: false,
        });
    }

    let metadata = std::fs::metadata(path)?;
    let size = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FirmwareFileInfo {
        path: file_path,
        size,
        modified,
        exists: true,
    })
}

#[cfg(test)]
mod tests {
    use super::ProgressState;

    #[test]
    fn progress_maps_erase_and_program_phases() {
        let mut state = ProgressState::new();
        assert_eq!(state.calculate_progress(), 0.0);

        state.erase_total = 100;
        state.erase_current = 50;
        assert!((state.calculate_progress() - 0.15).abs() < 1e-6);

        state.program_total = 200;
        state.program_current = 100;
        assert!((state.calculate_progress() - 0.60).abs() < 1e-6);

        state.program_current = 200;
        assert!((state.calculate_progress() - 0.90).abs() < 1e-6);
    }
}
