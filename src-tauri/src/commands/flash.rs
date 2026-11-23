use crate::commands::probe::{open_session_with_permissions, ConnectOptions, TargetInfo};
use crate::commands::{blocking, with_session};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, ResetMode};
use parking_lot::Mutex;
use probe_rs::flashing::{
    build_loader, download_file_with_options, erase, erase_all, BinLoader, BinOptions, DownloadOptions, ElfLoader,
    ElfOptions, FlashProgress, HexLoader, ImageLoader, ProgressEvent, ProgressOperation,
};
use probe_rs::{MemoryInterface, Permissions, Session};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
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
    // 烧录后复位使用的复位方式（配置检查器「复位方式」）
    #[serde(default)]
    pub reset_mode: ResetMode,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlashProgressEvent {
    pub phase: String,
    pub progress: f32,
    pub message: String,
}

/// 向前端发送一条烧录进度（失败忽略：窗口关闭时没有接收方）
fn emit_progress(window: &Window, phase: &str, progress: f32, message: impl Into<String>) {
    let _ = window.emit(
        "flash-progress",
        FlashProgressEvent {
            phase: phase.to_string(),
            progress,
            message: message.into(),
        },
    );
}

#[tauri::command]
pub async fn flash_firmware(options: FlashOptions, state: State<'_, AppState>, window: Window) -> AppResult<()> {
    // 烧录期间暂停 RTT 读取；结束后固件可能已变化，RTT 重新查找控制块
    let _rtt = state.rtt_state.suspend(true);
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

/// 按扩展名选择固件解析器（烧录与校验共用）。
/// 支持的格式: ELF, HEX, BIN, AXF (ARM ELF), OUT；BIN 不带地址信息，从 `bin_base` 开始放置。
fn image_loader(path: &Path, bin_base: u64) -> Box<dyn ImageLoader> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase());
    match ext.as_deref() {
        // Intel HEX 格式
        Some("hex") | Some("ihex") => {
            log::info!("检测到 HEX 格式固件");
            Box::new(HexLoader)
        }
        // 纯二进制格式 - 需要指定基地址
        Some("bin") => {
            log::info!("检测到 BIN 格式固件，基地址: 0x{:08X}", bin_base);
            Box::new(BinLoader(BinOptions {
                base_address: Some(bin_base),
                skip: 0,
            }))
        }
        // ELF 格式 (包括 AXF - ARM eXecutable Format)
        Some("elf") | Some("axf") | Some("out") => {
            log::info!("检测到 ELF 格式固件 (扩展名: {})", ext.as_deref().unwrap_or("unknown"));
            Box::new(ElfLoader(ElfOptions::default()))
        }
        // 未知扩展名 - 尝试作为 ELF 解析
        _ => {
            log::info!("未知扩展名 {:?}，尝试作为 ELF 格式解析", ext);
            Box::new(ElfLoader(ElfOptions::default()))
        }
    }
}

/// nRST 在 DAP_SWJ_Pins 引脚位图中的位置（CMSIS-DAP 定义，probe-rs 各探针驱动通用）
const NRESET_PIN: u32 = 1 << 7;

/// 按复位方式复位芯片并让它运行（工具栏「复位」与烧录后复位共用）。
/// - 软件复位：内核的系统复位请求（Cortex-M 为 AIRCR.SYSRESETREQ）
/// - 硬件复位：通过探针拉低 nRST 引脚，需要调试线连接了芯片的复位脚
pub(crate) fn reset_session(session: &mut Session, mode: ResetMode) -> AppResult<()> {
    match mode {
        ResetMode::Software => {
            let mut core = session.core(0).map_err(|e| AppError::ProbeError(e.to_string()))?;
            core.reset()
                .map_err(|e| AppError::ProbeError(format!("软件复位失败: {e}")))?;
        }
        ResetMode::Hardware => {
            let pin_error = |e: probe_rs::probe::DebugProbeError| {
                AppError::ProbeError(format!("硬件复位失败（探针无法控制 nRST 引脚）: {e}"))
            };
            let interface = session
                .get_arm_interface()
                .map_err(|e| AppError::ProbeError(format!("硬件复位目前仅支持 ARM 内核芯片，请改用软件复位: {e}")))?;
            interface.swj_pins(0, NRESET_PIN, 0).map_err(pin_error)?;
            std::thread::sleep(Duration::from_millis(20));
            interface.swj_pins(NRESET_PIN, NRESET_PIN, 0).map_err(pin_error)?;
            // 等芯片走完复位流程
            std::thread::sleep(Duration::from_millis(50));
            // 复位前内核若被调试器停住（如刚执行完烧录算法），复位后可能仍处于停机状态，这里让它运行起来
            if let Ok(mut core) = session.core(0) {
                if core.core_halted().unwrap_or(false) {
                    let _ = core.run();
                }
            }
        }
    }
    Ok(())
}

fn flash_firmware_blocking(session: &mut Session, options: FlashOptions, window: Window) -> AppResult<()> {
    let path = Path::new(&options.file_path);
    if !path.exists() {
        return Err(AppError::FileError("文件不存在".to_string()));
    }

    // BIN 基地址：启用自定义地址时用用户填写的值，否则自动取目标内存映射中的主 Flash 起始地址
    let bin_base = if options.use_custom_address.unwrap_or(false) {
        options.custom_flash_address.unwrap_or(0x08000000)
    } else {
        default_flash_start(session)
    };
    let format = image_loader(path, bin_base);

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
    emit_progress(&window, "finishing", 0.95, "烧录完成，正在收尾...");

    // 重置芯片
    if options.reset_after {
        let label = match options.reset_mode {
            ResetMode::Software => "软件复位",
            ResetMode::Hardware => "硬件复位",
        };
        emit_progress(&window, "reset", 0.98, format!("正在复位芯片（{label}）..."));
        reset_session(session, options.reset_mode)?;
    }

    emit_progress(&window, "complete", 1.0, "烧录完成");

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
    let _rtt = state.rtt_state.suspend(true);
    with_session(&state.session, move |session| {
        erase_chip_blocking(session, erase_mode, window)
    })
    .await
}

fn erase_chip_blocking(session: &mut Session, erase_mode: EraseMode, window: Window) -> AppResult<()> {
    match erase_mode {
        EraseMode::ChipErase => {
            emit_progress(&window, "erase", 0.0, "开始全片擦除");

            let mut progress = FlashProgress::new(|_| {});
            erase_all(session, &mut progress, false).map_err(|e| AppError::FlashError(e.to_string()))?;

            emit_progress(&window, "complete", 1.0, "全片擦除完成");
        }
        EraseMode::SectorErase => {
            emit_progress(&window, "erase", 0.0, "开始扇区擦除");

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

            emit_progress(&window, "complete", 1.0, "扇区擦除完成");
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

    let _rtt = state.rtt_state.suspend(true);
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
/// 校验 Flash 内容是否与固件一致，支持与烧录相同的全部格式（BIN / HEX / ELF / AXF / OUT）。
/// `address` 为 BIN 固件的起始地址，应与烧录时使用的地址一致；
/// 不传时使用主 Flash 起始地址（与烧录时未启用自定义地址的行为相同）。HEX / ELF 自带地址，忽略该参数。
pub async fn verify_firmware(
    file_path: String,
    address: Option<u64>,
    state: State<'_, AppState>,
    window: Window,
) -> AppResult<bool> {
    let _rtt = state.rtt_state.suspend(false);
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

    emit_progress(&window, "verify", 0.0, "开始校验");

    // 用与烧录相同的解析器把固件拆成「地址 + 数据」段，再逐段与芯片内容比对
    let bin_base = address.unwrap_or_else(|| default_flash_start(session));
    let loader = build_loader(session, path, image_loader(path, bin_base), None)
        .map_err(|e| AppError::FlashError(format!("解析固件失败: {:#}", e)))?;

    // 只比对落在 Flash 里的段：ELF 中加载到 RAM 的段在程序运行后内容会变化，比对没有意义
    let nvm_ranges: Vec<_> = session
        .target()
        .memory_map
        .iter()
        .filter_map(|region| match region {
            probe_rs::config::MemoryRegion::Nvm(r) => Some(r.range.clone()),
            _ => None,
        })
        .collect();
    let segments: Vec<(u64, &[u8])> = loader
        .data()
        .filter(|(addr, _)| nvm_ranges.iter().any(|range| range.contains(addr)))
        .collect();
    let total_size: usize = segments.iter().map(|(_, data)| data.len()).sum();
    if total_size == 0 {
        return Err(AppError::InvalidInput(
            "固件中没有位于 Flash 地址范围内的数据，无法校验（BIN 固件请检查起始地址）".to_string(),
        ));
    }

    let mut core = session.core(0).map_err(|e| AppError::FlashError(e.to_string()))?;

    // 分块校验 - 每块 4KB，大幅提升速度
    const CHUNK_SIZE: usize = 4096;
    let mut verified: usize = 0;
    let mut flash_buffer = vec![0u8; CHUNK_SIZE];

    for (segment_addr, segment) in &segments {
        for (index, expected) in segment.chunks(CHUNK_SIZE).enumerate() {
            let current_addr = segment_addr + (index * CHUNK_SIZE) as u64;
            let actual = &mut flash_buffer[..expected.len()];

            core.read(current_addr, actual)
                .map_err(|e| AppError::FlashError(e.to_string()))?;

            if let Some(offset) = actual.iter().zip(expected.iter()).position(|(a, b)| a != b) {
                emit_progress(
                    &window,
                    "error",
                    verified as f32 / total_size as f32,
                    format!(
                        "校验失败：地址 0x{:08X} 处数据不匹配（芯片 0x{:02X}，固件 0x{:02X}）",
                        current_addr + offset as u64,
                        actual[offset],
                        expected[offset]
                    ),
                );
                return Ok(false);
            }

            let before = verified;
            verified += expected.len();

            // 更新进度（每跨过 64KB 更新一次，减少开销）
            if before / (64 * 1024) != verified / (64 * 1024) || verified >= total_size {
                let progress = verified as f32 / total_size as f32;
                emit_progress(
                    &window,
                    "verify",
                    progress,
                    format!("已校验 {}/{} 字节 ({:.1}%)", verified, total_size, progress * 100.0),
                );
            }
        }
    }

    emit_progress(
        &window,
        "complete",
        1.0,
        format!("校验通过（{} 段，共 {} 字节）", segments.len(), total_size),
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

    let _rtt = state.rtt_state.suspend(false);
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

// ==================== 目标控制（工具栏 复位 / 停止 / 运行 / 解锁） ====================

/// 复位芯片；`reset_mode` 省略时使用软件复位
#[tauri::command]
pub async fn reset_target(reset_mode: Option<ResetMode>, state: State<'_, AppState>) -> AppResult<()> {
    // 复位后固件会重新初始化 RTT 控制块，结束后让 RTT 重新查找
    let _rtt = state.rtt_state.suspend(true);
    with_session(&state.session, move |session| {
        reset_session(session, reset_mode.unwrap_or_default())
    })
    .await
}

/// 停止（halt）内核，返回停下时的 PC
#[tauri::command]
pub async fn halt_target(state: State<'_, AppState>) -> AppResult<u64> {
    with_session(&state.session, |session| {
        let mut core = session.core(0).map_err(|e| AppError::ProbeError(e.to_string()))?;
        let info = core
            .halt(Duration::from_millis(500))
            .map_err(|e| AppError::ProbeError(format!("停止内核失败: {e}")))?;
        Ok(info.pc)
    })
    .await
}

/// 让内核继续运行
#[tauri::command]
pub async fn resume_target(state: State<'_, AppState>) -> AppResult<()> {
    with_session(&state.session, |session| {
        let mut core = session.core(0).map_err(|e| AppError::ProbeError(e.to_string()))?;
        core.run()
            .map_err(|e| AppError::ProbeError(format!("运行内核失败: {e}")))
    })
    .await
}

/// 解锁芯片：带「允许全片擦除」权限重新建立烧录连接，再整片擦除。
///
/// - 芯片描述带解锁序列的（如 nRF 的 APPROTECT）在连接阶段即由该序列擦除并解除保护，
///   所以芯片被锁、普通连接失败时也能用；
/// - 有专用擦除序列的芯片用该序列，其余芯片用烧录算法整片擦除。
///
/// 完成后保持连接并返回目标信息，前端按「已连接」处理。
#[tauri::command]
pub async fn unlock_chip(options: ConnectOptions, state: State<'_, AppState>, window: Window) -> AppResult<TargetInfo> {
    state.rtt_state.stop_if_sharing_main();
    let slot = Arc::clone(&state.session);
    let info_slot = Arc::clone(&state.connection_info);
    blocking(move || {
        // 关闭旧连接：解锁必须用带擦除权限的新连接
        *info_slot.lock() = None;
        drop(slot.lock().take());

        emit_progress(&window, "erase", 0.1, "正在以解锁模式连接芯片...");
        let mut opened = open_session_with_permissions(&options, Permissions::new().allow_erase_all())?;

        emit_progress(&window, "erase", 0.4, "正在全片擦除...");
        let session = &mut opened.session;
        if session.has_sequence_erase_all() {
            session
                .sequence_erase_all()
                .map_err(|e| AppError::FlashError(format!("芯片擦除序列执行失败: {e}")))?;
        } else {
            let mut progress = FlashProgress::new(|_| {});
            erase_all(session, &mut progress, false).map_err(|e| AppError::FlashError(e.to_string()))?;
        }
        emit_progress(&window, "complete", 1.0, "解锁完成，Flash 已全部擦除");

        *slot.lock() = Some(opened.session);
        *info_slot.lock() = Some(opened.connection_info);
        Ok(opened.target_info)
    })
    .await
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
