use crate::error::{AppError, AppResult};
use crate::state::AppState;
use probe_rs::rtt::{Rtt, ScanRegion};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// RTT 通道信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RttChannel {
    pub index: usize,
    pub name: String,
    pub buffer_size: usize,
}

/// RTT 配置响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RttConfig {
    pub up_channels: Vec<RttChannel>,
    pub down_channels: Vec<RttChannel>,
    pub control_block_address: Option<u64>,
}

/// RTT 启动选项
#[derive(Debug, Clone, Deserialize)]
pub struct RttStartOptions {
    /// 扫描模式: "auto" | "exact" | "range"
    pub scan_mode: String,
    /// 精确地址 (scan_mode="exact" 时使用)
    pub address: Option<u64>,
    /// 扫描范围起始地址 (scan_mode="range" 时使用)
    pub range_start: Option<u64>,
    /// 扫描范围大小 (scan_mode="range" 时使用)
    pub range_size: Option<u64>,
    /// 轮询间隔 (毫秒)，默认 10ms
    pub poll_interval: Option<u64>,
    /// 是否在读取时暂停目标 (默认 true，设为 false 可能更快但不稳定)
    pub halt_on_read: Option<bool>,
}

/// RTT 数据事件 (发送到前端)
#[derive(Debug, Clone, Serialize)]
pub struct RttDataEvent {
    pub channel: usize,
    pub data: Vec<u8>,
    pub timestamp: u64,
}

/// RTT 状态事件 (发送到前端)
#[derive(Debug, Clone, Serialize)]
pub struct RttStatusEvent {
    pub running: bool,
    pub error: Option<String>,
}

/// 启动 RTT 并开始持续轮询
#[tauri::command]
pub async fn start_rtt(
    options: RttStartOptions,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> AppResult<RttConfig> {
    // 检查是否已在运行
    if state.rtt_state.is_running() {
        return Err(AppError::RttError("RTT 已在运行中".to_string()));
    }

    // 根据扫描模式确定扫描范围
    let scan_region = match options.scan_mode.as_str() {
        "exact" => {
            let addr = options.address.unwrap_or(0x20000000);
            ScanRegion::Exact(addr)
        }
        "range" => {
            let start = options.range_start.unwrap_or(0x20000000);
            let size = options.range_size.unwrap_or(0x10000);
            let end = start
                .checked_add(size)
                .ok_or_else(|| AppError::RttError("扫描范围超出地址空间".to_string()))?;
            ScanRegion::range(start..end)
        }
        _ => {
            // auto: 从 RAM 开始扫描
            ScanRegion::Ram
        }
    };

    // 扫描控制块可能要几秒，放到阻塞线程里做，不占用异步运行时
    log::info!("开始附加 RTT，扫描模式: {:?}", options.scan_mode);
    let session_arc = Arc::clone(&state.rtt_session);
    let (up_channels, down_channels, control_block_address) =
        tokio::task::spawn_blocking(move || attach_rtt(&session_arc, &scan_region))
            .await
            .map_err(|e| AppError::RttError(format!("RTT 附加任务异常: {}", e)))??;

    let poll_interval = options.poll_interval.unwrap_or(10).max(1); // 默认 10ms
                                                                    // Linux 上 halt_on_read 会导致性能问题，默认设为 false
    let halt_on_read = options.halt_on_read.unwrap_or(false);
    log::info!("RTT 配置: 轮询间隔={}ms, 暂停读取={}", poll_interval, halt_on_read);

    // 每次轮询都是同步 USB 往返，用独立线程轮询，避免占住 tokio worker
    let generation = state.rtt_state.run.start();
    let rtt_state = Arc::clone(&state.rtt_state);
    let session_arc = Arc::clone(&state.rtt_session);
    std::thread::Builder::new()
        .name("rtt-poll".into())
        .spawn(move || {
            rtt_polling_loop(
                rtt_state,
                session_arc,
                app_handle,
                generation,
                poll_interval,
                halt_on_read,
                control_block_address,
            );
        })
        .map_err(|e| {
            state.rtt_state.run.finish(generation);
            AppError::RttError(format!("无法启动 RTT 轮询线程: {}", e))
        })?;

    Ok(RttConfig {
        up_channels,
        down_channels,
        control_block_address: Some(control_block_address),
    })
}

type SharedSession = Arc<parking_lot::Mutex<Option<probe_rs::Session>>>;

/// 附加 RTT，返回 (上行通道, 下行通道, 控制块地址)
fn attach_rtt(session: &SharedSession, scan_region: &ScanRegion) -> AppResult<(Vec<RttChannel>, Vec<RttChannel>, u64)> {
    let mut rtt_session_guard = session.lock();
    let session = rtt_session_guard
        .as_mut()
        .ok_or(AppError::RttError("RTT 未连接，请先连接 RTT".to_string()))?;

    let mut core = session.core(0).map_err(|e| AppError::RttError(e.to_string()))?;

    log::info!("开始扫描 RTT 控制块...");
    let attach_start = Instant::now();
    let mut rtt = Rtt::attach_region(&mut core, scan_region).map_err(|e| {
        log::error!("RTT 附加失败 (耗时 {:?}): {}", attach_start.elapsed(), e);
        let msg = e.to_string();
        if msg.contains("control block") || msg.contains("RTT") {
            AppError::RttError("未找到 RTT 控制块。请确保目标固件已集成 SEGGER RTT 库。".to_string())
        } else if msg.contains("ARM") {
            AppError::RttError("无法读取目标内存。请检查：1) 目标设备是否正在运行 2) 固件是否包含 RTT 支持".to_string())
        } else {
            AppError::RttError(format!("无法附加 RTT: {}", e))
        }
    })?;
    log::info!(
        "RTT 附加成功，耗时: {:?}，控制块地址: 0x{:08X}",
        attach_start.elapsed(),
        rtt.ptr()
    );

    let up_channels = rtt
        .up_channels()
        .iter()
        .map(|c| RttChannel {
            index: c.number(),
            name: c.name().unwrap_or("").to_string(),
            buffer_size: c.buffer_size(),
        })
        .collect();
    let down_channels = rtt
        .down_channels()
        .iter()
        .map(|c| RttChannel {
            index: c.number(),
            name: c.name().unwrap_or("").to_string(),
            buffer_size: c.buffer_size(),
        })
        .collect();

    Ok((up_channels, down_channels, rtt.ptr()))
}

/// RTT 轮询循环（运行在独立线程）
fn rtt_polling_loop(
    rtt_state: Arc<crate::state::RttState>,
    session: SharedSession,
    app_handle: AppHandle,
    generation: u64,
    poll_interval_ms: u64,
    halt_on_read: bool,
    control_block_addr: u64,
) {
    const MAX_CONSECUTIVE_ERRORS: u32 = 50;
    log::info!(
        "RTT 轮询启动: 间隔={}ms, 暂停读取={}, 控制块地址=0x{:08X}",
        poll_interval_ms,
        halt_on_read,
        control_block_addr
    );

    let _ = app_handle.emit(
        "rtt-status",
        RttStatusEvent {
            running: true,
            error: None,
        },
    );

    let interval = Duration::from_millis(poll_interval_ms);
    let mut next_tick = Instant::now();
    let mut buffer = vec![0u8; 8192];
    // 控制块位置在一次运行内不变：缓存 Rtt 对象，只在读失败（例如目标复位）后重新附加
    let mut rtt: Option<Rtt> = None;
    let mut consecutive_errors = 0u32;

    let error = loop {
        // 错过的周期直接跳过，不补发
        next_tick += interval;
        let now = Instant::now();
        if next_tick > now {
            std::thread::sleep(next_tick - now);
        } else {
            next_tick = now;
        }

        if !rtt_state.run.is_current(generation) {
            log::info!("RTT 轮询任务停止");
            break None;
        }

        match poll_rtt_once(&session, &mut rtt, &mut buffer, control_block_addr, halt_on_read) {
            Ok(events) => {
                consecutive_errors = 0;
                for event in events {
                    if let Err(e) = app_handle.emit("rtt-data", &event) {
                        log::error!("发送 RTT 数据事件失败: {}", e);
                    }
                }
            }
            Err(PollError::Busy) => {}
            Err(PollError::Fatal(msg)) => break Some(msg),
            Err(PollError::Transient(msg)) => {
                consecutive_errors += 1;
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    log::error!("RTT 连续 {} 次读取失败: {}", consecutive_errors, msg);
                    break Some(msg);
                }
                if consecutive_errors.is_multiple_of(10) {
                    log::warn!("RTT 读取失败 (第 {} 次): {}", consecutive_errors, msg);
                }
            }
        }
    };

    // 结束事件只发一次，错误原因不会被随后的空状态覆盖；
    // 已被新一轮启动取代时不发，避免把新一轮误报为已停止。
    if rtt_state.run.finish(generation) || !rtt_state.is_running() {
        let _ = app_handle.emit("rtt-status", RttStatusEvent { running: false, error });
    }
    log::info!("RTT 轮询任务已完全结束");
}

enum PollError {
    /// session 被其他操作占用，本轮跳过
    Busy,
    /// 可重试的错误，计入连续错误次数
    Transient(String),
    /// 无法继续，结束轮询
    Fatal(String),
}

/// 执行一次 RTT 轮询
fn poll_rtt_once(
    session: &SharedSession,
    rtt: &mut Option<Rtt>,
    buffer: &mut [u8],
    control_block_addr: u64,
    halt_on_read: bool,
) -> Result<Vec<RttDataEvent>, PollError> {
    let Some(mut session_guard) = session.try_lock_for(Duration::from_millis(500)) else {
        log::warn!("无法获取 session 锁（可能被其他操作占用）");
        return Err(PollError::Busy);
    };
    let Some(session) = session_guard.as_mut() else {
        log::warn!("Session 已断开，停止 RTT");
        return Err(PollError::Fatal("设备连接已断开".to_string()));
    };
    let mut core = session
        .core(0)
        .map_err(|e| PollError::Transient(format!("无法访问目标芯片: {}", e)))?;

    // 根据设置决定是否暂停目标
    let was_running = if halt_on_read {
        match core.core_halted() {
            Ok(false) => {
                if let Err(e) = core.halt(Duration::from_millis(50)) {
                    log::debug!("暂停目标芯片失败: {}", e);
                    return Ok(Vec::new());
                }
                true
            }
            Ok(true) => false,
            Err(e) => {
                log::debug!("检查 core 状态失败: {}", e);
                return Ok(Vec::new());
            }
        }
    } else {
        false
    };

    let result = read_rtt_data(&mut core, rtt, buffer, control_block_addr);

    // 恢复运行
    if was_running {
        if let Err(e) = core.run() {
            log::warn!("恢复目标芯片运行失败: {}", e);
            let _ = core.run();
        }
    }

    result
}

/// 读取所有 up 通道；读失败时丢弃缓存的 Rtt，下一轮重新附加
fn read_rtt_data(
    core: &mut probe_rs::Core,
    rtt: &mut Option<Rtt>,
    buffer: &mut [u8],
    control_block_addr: u64,
) -> Result<Vec<RttDataEvent>, PollError> {
    let attached = match rtt {
        Some(attached) => attached,
        None => rtt.insert(
            Rtt::attach_region(core, &ScanRegion::Exact(control_block_addr)).map_err(|e| {
                PollError::Transient(format!("RTT 控制块 0x{:08X} 附加失败: {}", control_block_addr, e))
            })?,
        ),
    };

    let mut events = Vec::new();
    let mut read_error = None;
    for ch in attached.up_channels().iter_mut() {
        let channel_num = ch.number();
        match ch.read(core, buffer) {
            Ok(0) => {}
            Ok(count) => {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                events.push(RttDataEvent {
                    channel: channel_num,
                    data: buffer[..count].to_vec(),
                    timestamp,
                });
            }
            Err(e) => {
                read_error = Some(format!("读取 RTT 通道 {} 失败: {}", channel_num, e));
                break;
            }
        }
    }

    match read_error {
        // 已读到的数据仍然上报；Rtt 丢弃后下一轮重新附加
        Some(msg) if events.is_empty() => {
            *rtt = None;
            Err(PollError::Transient(msg))
        }
        Some(_) => {
            *rtt = None;
            Ok(events)
        }
        None => Ok(events),
    }
}

/// 停止 RTT
#[tauri::command]
pub async fn stop_rtt(state: State<'_, AppState>) -> AppResult<()> {
    if !state.rtt_state.is_running() {
        return Ok(());
    }

    state.rtt_state.run.stop();
    log::info!("RTT 停止请求已发送");

    Ok(())
}

// 清空 RTT 缓冲区 (前端调用)
///
/// 后端目前不缓存任何 RTT 行数据，行缓冲完全在前端 store 中维护，
/// 此命令保留是为了与前端 invoke("clear_rtt_buffer") 调用兼容。
#[tauri::command]
pub async fn clear_rtt_buffer(_state: State<'_, AppState>) -> AppResult<()> {
    Ok(())
}
