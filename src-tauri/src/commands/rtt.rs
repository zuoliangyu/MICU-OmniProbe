use crate::error::{AppError, AppResult};
use crate::state::{AppState, RttState};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use probe_rs::rtt::{Error as RttLibError, Rtt, ScanRegion};
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
    /// 实际使用的控制块查找方式说明，例如“ELF 符号 _SEGGER_RTT”
    pub located_by: String,
    /// 使用的探针连接："rtt" 独立 RTT 连接 | "main" 借用烧录连接
    pub session_source: String,
}

/// RTT 启动选项
#[derive(Debug, Clone, Deserialize)]
pub struct RttStartOptions {
    /// 扫描模式: "auto" | "exact" | "range" | "elf"
    pub scan_mode: String,
    /// 精确地址 (scan_mode="exact" 时使用)
    pub address: Option<u64>,
    /// 扫描范围起始地址 (scan_mode="range" 时使用)
    pub range_start: Option<u64>,
    /// 扫描范围大小 (scan_mode="range" 时使用)
    pub range_size: Option<u64>,
    /// ELF 文件路径 (scan_mode="elf" 时使用)，从中读取 `_SEGGER_RTT` 符号地址
    pub elf_path: Option<String>,
    /// 轮询间隔 (毫秒)，默认 10ms
    pub poll_interval: Option<u64>,
    /// 读取时是否暂停目标，默认 false（暂停会影响目标实时性，仅在探针不支持后台访问时使用）
    pub halt_on_read: Option<bool>,
    /// 访问的核心编号，默认 0
    pub core_index: Option<usize>,
    /// 目标失联多久后放弃（毫秒），默认 10 秒；期间持续尝试重新附加
    pub recover_timeout_ms: Option<u64>,
}

/// RTT 数据事件 (发送到前端)。一次轮询的所有通道数据合并为一个事件，字节用 base64 编码，
/// 比 JSON 数字数组小约 3 倍，也减少高吞吐时的事件次数。
#[derive(Debug, Clone, Serialize)]
pub struct RttDataBatch {
    pub timestamp: u64,
    pub chunks: Vec<RttDataChunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RttDataChunk {
    pub channel: usize,
    pub data: String,
}

/// RTT 状态事件 (发送到前端)
#[derive(Debug, Clone, Serialize)]
pub struct RttStatusEvent {
    pub running: bool,
    pub error: Option<String>,
    /// 运行中的附加状态："attached" 正常读取 | "recovering" 目标复位或重新烧录后正在重新查找控制块
    pub phase: Option<String>,
    /// 重新附加后的通道信息；仅在控制块变化时携带
    pub config: Option<RttConfig>,
}

/// 控制块查找方式。ELF 模式在启动时解析为精确地址。
#[derive(Debug, Clone)]
struct ScanSpec {
    region: ScanRegion,
    described: String,
    /// ELF 模式记录文件路径：重新烧录后符号地址可能变化，恢复时重新读取
    elf_path: Option<String>,
}

impl ScanSpec {
    fn from_options(options: &RttStartOptions) -> AppResult<Self> {
        match options.scan_mode.as_str() {
            "exact" => {
                let addr = options
                    .address
                    .ok_or_else(|| AppError::InvalidInput("精确地址模式需要填写控制块地址".into()))?;
                Ok(Self {
                    region: ScanRegion::Exact(addr),
                    described: format!("指定地址 0x{addr:08X}"),
                    elf_path: None,
                })
            }
            "range" => {
                let start = options
                    .range_start
                    .ok_or_else(|| AppError::InvalidInput("范围扫描需要填写起始地址".into()))?;
                let size = options.range_size.filter(|s| *s > 0).unwrap_or(0x10000);
                let end = start
                    .checked_add(size)
                    .ok_or_else(|| AppError::InvalidInput("扫描范围超出地址空间".into()))?;
                Ok(Self {
                    region: ScanRegion::range(start..end),
                    described: format!("范围 0x{start:08X}-0x{end:08X}"),
                    elf_path: None,
                })
            }
            "elf" => {
                let path = options
                    .elf_path
                    .as_deref()
                    .filter(|p| !p.trim().is_empty())
                    .ok_or_else(|| AppError::InvalidInput("ELF 模式需要选择固件 ELF 文件".into()))?;
                let addr = find_rtt_symbol(path)?;
                Ok(Self {
                    region: ScanRegion::Exact(addr),
                    described: format!("ELF 符号 _SEGGER_RTT (0x{addr:08X})"),
                    elf_path: Some(path.to_string()),
                })
            }
            _ => Ok(Self {
                region: ScanRegion::Ram,
                described: "自动扫描 RAM".into(),
                elf_path: None,
            }),
        }
    }

    /// 已知地址失效后（例如重新烧录了不同固件）的回退查找方式。
    /// 指定地址/ELF 模式下用户明确给出了位置，回退到整片 RAM 扫描。
    fn fallback(&self) -> Option<ScanRegion> {
        match self.region {
            ScanRegion::Exact(_) => Some(ScanRegion::Ram),
            _ => None,
        }
    }
}

/// 从 ELF 符号表读取 `_SEGGER_RTT` 地址
fn find_rtt_symbol(path: &str) -> AppResult<u64> {
    use object::{Object, ObjectSymbol};
    let bytes = std::fs::read(path).map_err(|e| AppError::InvalidInput(format!("读取 ELF 失败: {e}")))?;
    let obj = object::File::parse(&*bytes).map_err(|e| AppError::InvalidInput(format!("解析 ELF 失败: {e}")))?;
    obj.symbols()
        .find(|s| s.name() == Ok("_SEGGER_RTT"))
        .map(|s| s.address())
        .ok_or_else(|| {
            AppError::RttError(
                "ELF 中没有 _SEGGER_RTT 符号。请确认固件已集成 SEGGER RTT，且选择的是带符号的 ELF/AXF 文件。".into(),
            )
        })
}

/// 启动 RTT 并开始持续轮询
#[tauri::command]
pub async fn start_rtt(
    options: RttStartOptions,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> AppResult<RttConfig> {
    // 检查并占位在同一次原子操作里完成：扫描控制块要几秒，期间重复点击会直接被拒绝
    let generation = state
        .rtt_state
        .run
        .try_start()
        .ok_or_else(|| AppError::RttError("RTT 已在运行或正在启动".to_string()))?;

    let prepared = (|| -> AppResult<_> {
        let spec = ScanSpec::from_options(&options)?;
        let poll_interval = options.poll_interval.unwrap_or(10).clamp(1, 1000);
        let halt_on_read = options.halt_on_read.unwrap_or(false);
        let core_index = options.core_index.unwrap_or(0);
        let recover_timeout = Duration::from_millis(options.recover_timeout_ms.unwrap_or(10_000).clamp(1_000, 600_000));
        Ok((spec, poll_interval, halt_on_read, core_index, recover_timeout))
    })();
    let (spec, poll_interval, halt_on_read, core_index, recover_timeout) = match prepared {
        Ok(values) => values,
        Err(e) => {
            state.rtt_state.run.finish(generation);
            return Err(e);
        }
    };

    // 优先用独立 RTT 连接；没有时借用烧录连接，同一探针无需打开两次，烧录时也不用断开
    let (session_slot, source) = if state.rtt_connection_info.lock().is_some() {
        (Arc::clone(&state.rtt_session), "rtt")
    } else if state.connection_info.lock().is_some() {
        (Arc::clone(&state.session), "main")
    } else {
        state.rtt_state.run.finish(generation);
        return Err(AppError::RttError(
            "请先连接设备（烧录连接或 RTT 连接均可）".to_string(),
        ));
    };
    state
        .rtt_state
        .shares_main
        .store(source == "main", std::sync::atomic::Ordering::SeqCst);

    log::info!("开始附加 RTT: {}，核心 {}，连接 {}", spec.described, core_index, source);
    let session_arc = Arc::clone(&session_slot);
    let attach_spec = spec.clone();
    let attached = tokio::task::spawn_blocking(move || attach_rtt(&session_arc, core_index, &attach_spec, source))
        .await
        .map_err(|e| AppError::RttError(format!("RTT 附加任务异常: {}", e)))
        .and_then(|r| r);
    let config = match attached {
        Ok(config) => config,
        Err(e) => {
            state.rtt_state.run.finish(generation);
            return Err(e);
        }
    };
    // 启动期间用户点了停止或断开，不再起轮询线程
    if !state.rtt_state.run.is_current(generation) {
        return Err(AppError::RttError("RTT 启动已取消".to_string()));
    }

    log::info!(
        "RTT 配置: 轮询间隔={}ms, 暂停读取={}, 失联超时={:?}",
        poll_interval,
        halt_on_read,
        recover_timeout
    );
    state
        .rtt_state
        .down
        .lock()
        .reset(config.down_channels.iter().map(|c| c.index).collect());

    // 每次轮询都是同步 USB 往返，用独立线程轮询，避免占住 tokio worker
    let poller = Poller {
        rtt_state: Arc::clone(&state.rtt_state),
        session: session_slot,
        session_source: source,
        app_handle,
        generation,
        interval: Duration::from_millis(poll_interval),
        halt_on_read,
        core_index,
        recover_timeout,
        spec,
        control_block: config.control_block_address.unwrap_or_default(),
    };
    std::thread::Builder::new()
        .name("rtt-poll".into())
        .spawn(move || poller.run())
        .map_err(|e| {
            state.rtt_state.run.finish(generation);
            AppError::RttError(format!("无法启动 RTT 轮询线程: {}", e))
        })?;

    Ok(config)
}

type SharedSession = Arc<parking_lot::Mutex<Option<probe_rs::Session>>>;

fn channel_info(rtt: &mut Rtt, located_by: String, session_source: &str) -> RttConfig {
    RttConfig {
        up_channels: rtt
            .up_channels()
            .iter()
            .map(|c| RttChannel {
                index: c.number(),
                name: c.name().unwrap_or("").to_string(),
                buffer_size: c.buffer_size(),
            })
            .collect(),
        down_channels: rtt
            .down_channels()
            .iter()
            .map(|c| RttChannel {
                index: c.number(),
                name: c.name().unwrap_or("").to_string(),
                buffer_size: c.buffer_size(),
            })
            .collect(),
        control_block_address: Some(rtt.ptr()),
        located_by,
        session_source: session_source.to_string(),
    }
}

/// 把 probe-rs 的 RTT 错误翻译成可操作的提示。按错误类型区分，而不是匹配错误文本。
fn describe_attach_error(e: &RttLibError, spec: &ScanSpec) -> String {
    match e {
        RttLibError::ControlBlockNotFound | RttLibError::NoControlBlockLocation => format!(
            "未找到 RTT 控制块（{}）。请确认：1) 固件已集成 SEGGER RTT 并已执行到 SEGGER_RTT_Init 之后；\
             2) 目标正在运行而不是停在复位或断点处；3) RAM 较大时改用 ELF 符号或指定地址。",
            spec.described
        ),
        RttLibError::MultipleControlBlocksFound(addrs) => format!(
            "在扫描范围内找到多个 RTT 控制块（{}）。请改用指定地址或 ELF 符号模式。",
            addrs
                .iter()
                .map(|a| format!("0x{a:08X}"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        RttLibError::ControlBlockCorrupted(detail) => {
            format!("RTT 控制块内容异常：{detail}。目标可能尚未完成初始化，或地址指向的不是控制块。")
        }
        RttLibError::Probe(inner) => format!("访问目标内存失败：{inner}。请检查接线、目标供电和时钟速度。"),
        other => format!("无法附加 RTT：{other}"),
    }
}

/// 附加 RTT，返回通道配置
fn attach_rtt(session: &SharedSession, core_index: usize, spec: &ScanSpec, source: &str) -> AppResult<RttConfig> {
    let mut guard = session.lock();
    let session = guard
        .as_mut()
        .ok_or(AppError::RttError("设备连接已断开，请重新连接".to_string()))?;
    let core_count = session.target().cores.len();
    if core_index >= core_count {
        return Err(AppError::InvalidInput(format!(
            "核心编号 {core_index} 超出范围，目标只有 {core_count} 个核心"
        )));
    }
    let mut core = session
        .core(core_index)
        .map_err(|e| AppError::RttError(e.to_string()))?;

    let attach_start = Instant::now();
    let mut rtt = Rtt::attach_region(&mut core, &spec.region).map_err(|e| {
        log::error!("RTT 附加失败 (耗时 {:?}): {}", attach_start.elapsed(), e);
        AppError::RttError(describe_attach_error(&e, spec))
    })?;
    log::info!(
        "RTT 附加成功，耗时: {:?}，控制块地址: 0x{:08X}",
        attach_start.elapsed(),
        rtt.ptr()
    );
    Ok(channel_info(&mut rtt, spec.described.clone(), source))
}

enum PollError {
    /// session 被其他操作占用，本轮跳过
    Busy,
    /// 可重试的错误；持续超过失联超时后结束轮询
    Transient(String),
    /// 无法继续，结束轮询
    Fatal(String),
}

/// 一轮轮询的结果
#[derive(Default)]
struct PollOutcome {
    chunks: Vec<RttDataChunk>,
    /// 本轮重新附加到了控制块（地址或通道可能已变化）
    reattached: Option<RttConfig>,
}

struct Poller {
    rtt_state: Arc<RttState>,
    session: SharedSession,
    session_source: &'static str,
    app_handle: AppHandle,
    generation: u64,
    interval: Duration,
    halt_on_read: bool,
    core_index: usize,
    recover_timeout: Duration,
    spec: ScanSpec,
    /// 上一次成功附加的控制块地址，重新附加时优先尝试
    control_block: u64,
}

impl Poller {
    fn emit_status(&self, running: bool, error: Option<String>, phase: Option<&str>, config: Option<RttConfig>) {
        let _ = self.app_handle.emit(
            "rtt-status",
            RttStatusEvent {
                running,
                error,
                phase: phase.map(str::to_string),
                config,
            },
        );
    }

    fn run(mut self) {
        log::info!(
            "RTT 轮询启动: 间隔={:?}, 暂停读取={}, 控制块地址=0x{:08X}",
            self.interval,
            self.halt_on_read,
            self.control_block
        );
        self.emit_status(true, None, Some("attached"), None);

        let mut next_tick = Instant::now();
        let mut buffer = vec![0u8; 16 * 1024];
        // 控制块位置在一次运行内通常不变：缓存 Rtt 对象，只在读失败或烧录后重新附加
        let mut rtt: Option<Rtt> = None;
        let mut rescan_epoch = self.rtt_state.rescan_epoch();
        // 第一次失败的时间；按时长而不是次数判断失联，目标复位、长时间启动都能等到
        let mut failing_since: Option<Instant> = None;
        let mut last_warn = Instant::now();

        let error = loop {
            // 错过的周期直接跳过，不补发
            next_tick += self.interval;
            let now = Instant::now();
            if next_tick > now {
                std::thread::sleep(next_tick - now);
            } else {
                next_tick = now;
            }

            if !self.rtt_state.run.is_current(self.generation) {
                log::info!("RTT 轮询任务停止");
                break None;
            }

            // 烧录/擦除期间不碰探针；结束后若固件可能变化，丢弃控制块重新查找
            if self.rtt_state.is_suspended() {
                continue;
            }
            let epoch = self.rtt_state.rescan_epoch();
            if epoch != rescan_epoch {
                rescan_epoch = epoch;
                if rtt.take().is_some() {
                    log::info!("目标固件可能已更新，重新查找 RTT 控制块");
                    self.emit_status(true, None, Some("recovering"), None);
                }
            }

            match self.poll_once(&mut rtt, &mut buffer) {
                Ok(outcome) => {
                    if failing_since.take().is_some() || outcome.reattached.is_some() {
                        self.emit_status(true, None, Some("attached"), outcome.reattached);
                    }
                    if !outcome.chunks.is_empty() {
                        let batch = RttDataBatch {
                            timestamp: unix_millis(),
                            chunks: outcome.chunks,
                        };
                        if let Err(e) = self.app_handle.emit("rtt-data", &batch) {
                            log::error!("发送 RTT 数据事件失败: {}", e);
                        }
                    }
                }
                Err(PollError::Busy) => {}
                Err(PollError::Fatal(msg)) => break Some(msg),
                Err(PollError::Transient(msg)) => {
                    let since = *failing_since.get_or_insert_with(|| {
                        self.emit_status(true, None, Some("recovering"), None);
                        Instant::now()
                    });
                    if since.elapsed() >= self.recover_timeout {
                        log::error!("RTT 持续 {:?} 无法恢复: {}", self.recover_timeout, msg);
                        break Some(format!(
                            "目标失联超过 {} 秒，RTT 已停止：{}",
                            self.recover_timeout.as_secs(),
                            msg
                        ));
                    }
                    if last_warn.elapsed() >= Duration::from_secs(2) {
                        last_warn = Instant::now();
                        log::warn!("RTT 正在恢复: {}", msg);
                    }
                    // 失联期间放慢重试，避免整片扫描把探针占满
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        };

        self.rtt_state.down.lock().reset(Vec::new());
        // 结束事件只发一次，错误原因不会被随后的空状态覆盖；
        // 已被新一轮启动取代时不发，避免把新一轮误报为已停止。
        if self.rtt_state.run.finish(self.generation) || !self.rtt_state.is_running() {
            self.emit_status(false, error, None, None);
        }
        log::info!("RTT 轮询任务已完全结束");
    }

    /// 执行一次 RTT 轮询：必要时重新附加，读取所有上行通道，再写出排队的下行数据
    fn poll_once(&mut self, rtt: &mut Option<Rtt>, buffer: &mut [u8]) -> Result<PollOutcome, PollError> {
        let Some(mut session_guard) = self.session.try_lock_for(Duration::from_millis(500)) else {
            log::debug!("无法获取 RTT session 锁（可能被其他操作占用）");
            return Err(PollError::Busy);
        };
        let Some(session) = session_guard.as_mut() else {
            return Err(PollError::Fatal("设备连接已断开".to_string()));
        };
        let mut core = session
            .core(self.core_index)
            .map_err(|e| PollError::Transient(format!("无法访问目标芯片: {}", e)))?;

        let mut outcome = PollOutcome::default();
        if rtt.is_none() {
            let mut attached = self.reattach(&mut core)?;
            let located_by = if attached.ptr() == self.control_block {
                self.spec.described.clone()
            } else {
                format!("重新扫描 (0x{:08X})", attached.ptr())
            };
            self.control_block = attached.ptr();
            outcome.reattached = Some(channel_info(&mut attached, located_by, self.session_source));
            self.rtt_state
                .down
                .lock()
                .reset(attached.down_channels().iter().map(|c| c.number()).collect());
            *rtt = Some(attached);
        }
        let attached = rtt.as_mut().expect("上面已确保附加");

        // 根据设置决定是否暂停目标
        let was_running = if self.halt_on_read {
            match core.core_halted() {
                Ok(false) => {
                    core.halt(Duration::from_millis(50))
                        .map_err(|e| PollError::Transient(format!("暂停目标芯片失败: {e}")))?;
                    true
                }
                Ok(true) => false,
                Err(e) => return Err(PollError::Transient(format!("检查核心状态失败: {e}"))),
            }
        } else {
            false
        };

        let result = transfer(&mut core, attached, buffer, &self.rtt_state);

        if was_running {
            if let Err(e) = core.run() {
                log::warn!("恢复目标芯片运行失败: {}", e);
                let _ = core.run();
            }
        }

        match result {
            Ok(chunks) => {
                outcome.chunks = chunks;
                Ok(outcome)
            }
            // 已读到的数据仍然上报；Rtt 丢弃后下一轮重新附加
            Err((chunks, msg)) => {
                *rtt = None;
                if chunks.is_empty() && outcome.reattached.is_none() {
                    Err(PollError::Transient(msg))
                } else {
                    outcome.chunks = chunks;
                    Ok(outcome)
                }
            }
        }
    }

    /// 先试上次的地址；失败后按原查找方式（或其回退方式）重新扫描，覆盖重新烧录后控制块移位的情况
    fn reattach(&self, core: &mut probe_rs::Core) -> Result<Rtt, PollError> {
        // ELF 模式：文件可能已被重新编译，先按最新符号地址查找
        if let Some(addr) = self.spec.elf_path.as_deref().and_then(|p| find_rtt_symbol(p).ok()) {
            if let Ok(rtt) = Rtt::attach_at(core, addr) {
                return Ok(rtt);
            }
        }
        if self.control_block != 0 {
            if let Ok(rtt) = Rtt::attach_at(core, self.control_block) {
                return Ok(rtt);
            }
        }
        let region = match &self.spec.region {
            ScanRegion::Exact(addr) if *addr == self.control_block => self.spec.fallback(),
            region => Some(region.clone()),
        };
        let Some(region) = region else {
            return Err(PollError::Transient(format!(
                "控制块 0x{:08X} 暂不可用",
                self.control_block
            )));
        };
        Rtt::attach_region(core, &region).map_err(|e| PollError::Transient(describe_attach_error(&e, &self.spec)))
    }
}

/// 读取所有上行通道，再写出下行队列。出错时返回已读到的数据和错误信息。
fn transfer(
    core: &mut probe_rs::Core,
    rtt: &mut Rtt,
    buffer: &mut [u8],
    rtt_state: &RttState,
) -> Result<Vec<RttDataChunk>, (Vec<RttDataChunk>, String)> {
    let mut chunks = Vec::new();
    for ch in rtt.up_channels().iter_mut() {
        let channel = ch.number();
        // 单轮最多读一个缓冲区；读满说明还有余量，继续读到空为止，避免高吞吐时目标端溢出
        loop {
            match ch.read(core, buffer) {
                Ok(0) => break,
                Ok(count) => {
                    chunks.push(RttDataChunk {
                        channel,
                        data: BASE64.encode(&buffer[..count]),
                    });
                    if count < buffer.len() {
                        break;
                    }
                }
                Err(e) => return Err((chunks, format!("读取 RTT 通道 {channel} 失败: {e}"))),
            }
        }
    }

    // 下行：一次只处理队首；目标缓冲区放不下时留下剩余部分，下一轮继续
    let mut down = rtt_state.down.lock();
    while let Some((channel, data)) = down.pending.front_mut() {
        let Some(ch) = rtt.down_channels().iter_mut().find(|c| c.number() == *channel) else {
            log::warn!("下行通道 {} 不存在，丢弃 {} 字节", channel, data.len());
            down.pending.pop_front();
            continue;
        };
        match ch.write(core, data) {
            Ok(written) if written >= data.len() => {
                down.pending.pop_front();
            }
            Ok(written) => {
                data.drain(..written);
                break;
            }
            Err(e) => return Err((chunks, format!("写入 RTT 下行通道 {channel} 失败: {e}"))),
        }
    }
    Ok(chunks)
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 下行队列上限，防止目标不读取时无限堆积
const MAX_DOWN_PENDING: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
pub struct RttWriteOptions {
    pub channel: usize,
    /// 原始字节；与 text 二选一
    pub data: Option<Vec<u8>>,
    pub text: Option<String>,
    #[serde(default = "default_encoding")]
    pub encoding: String,
    #[serde(default)]
    pub line_ending: String,
}

fn default_encoding() -> String {
    "utf-8".into()
}

/// 向下行通道发送数据。数据进入队列，由轮询线程在下一轮写入目标；返回入队字节数。
#[tauri::command]
pub async fn write_rtt(options: RttWriteOptions, state: State<'_, AppState>) -> AppResult<usize> {
    if !state.rtt_state.is_running() {
        return Err(AppError::RttError("RTT 未运行，请先启动".into()));
    }
    let bytes = match (options.data, options.text) {
        (Some(data), _) => data,
        (None, Some(text)) => super::serial::encode_serial_text(text, &options.encoding, &options.line_ending),
        (None, None) => return Err(AppError::InvalidInput("没有要发送的数据".into())),
    };
    if bytes.is_empty() {
        return Ok(0);
    }
    let mut down = state.rtt_state.down.lock();
    if !down.channels.contains(&options.channel) {
        return Err(AppError::RttError(if down.channels.is_empty() {
            "目标固件没有可用的下行通道（SEGGER_RTT_MAX_NUM_DOWN_BUFFERS 为 0，或 RTT 正在重新附加）".into()
        } else {
            format!("下行通道 {} 不存在", options.channel)
        }));
    }
    if down.pending_bytes() + bytes.len() > MAX_DOWN_PENDING {
        return Err(AppError::RttError(
            "下行发送队列已满：目标没有及时读取下行缓冲区（固件需要调用 SEGGER_RTT_Read / SEGGER_RTT_GetKey）".into(),
        ));
    }
    let len = bytes.len();
    down.pending.push_back((options.channel, bytes));
    Ok(len)
}

/// 停止 RTT
#[tauri::command]
pub async fn stop_rtt(state: State<'_, AppState>) -> AppResult<()> {
    // 启动中（扫描控制块期间）也会被取消：启动流程扫描结束后检查代次，不再起轮询线程
    if state.rtt_state.is_running() {
        state.rtt_state.run.stop();
        log::info!("RTT 停止请求已发送");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(mode: &str) -> RttStartOptions {
        RttStartOptions {
            scan_mode: mode.into(),
            address: None,
            range_start: None,
            range_size: None,
            elf_path: None,
            poll_interval: None,
            halt_on_read: None,
            core_index: None,
            recover_timeout_ms: None,
        }
    }

    #[test]
    fn exact_mode_requires_address_and_falls_back_to_ram() {
        assert!(ScanSpec::from_options(&options("exact")).is_err());
        let spec = ScanSpec::from_options(&RttStartOptions {
            address: Some(0x2000_0400),
            ..options("exact")
        })
        .unwrap();
        assert!(matches!(spec.region, ScanRegion::Exact(0x2000_0400)));
        assert!(matches!(spec.fallback(), Some(ScanRegion::Ram)));
    }

    #[test]
    fn range_mode_rejects_overflow_and_has_no_fallback() {
        let overflow = RttStartOptions {
            range_start: Some(u64::MAX - 1),
            range_size: Some(0x100),
            ..options("range")
        };
        assert!(ScanSpec::from_options(&overflow).is_err());
        let spec = ScanSpec::from_options(&RttStartOptions {
            range_start: Some(0x2000_0000),
            range_size: Some(0x1000),
            ..options("range")
        })
        .unwrap();
        assert!(spec.fallback().is_none());
    }

    #[test]
    fn unknown_mode_scans_ram() {
        let spec = ScanSpec::from_options(&options("auto")).unwrap();
        assert!(matches!(spec.region, ScanRegion::Ram));
    }

    #[test]
    fn elf_mode_reports_missing_file() {
        let spec = ScanSpec::from_options(&RttStartOptions {
            elf_path: Some("Z:/micu-nonexistent/fw.elf".into()),
            ..options("elf")
        });
        assert!(spec.is_err());
        assert!(ScanSpec::from_options(&options("elf")).is_err());
    }

    #[test]
    fn attach_errors_are_classified_by_variant() {
        let spec = ScanSpec::from_options(&options("auto")).unwrap();
        let not_found = describe_attach_error(&RttLibError::ControlBlockNotFound, &spec);
        assert!(not_found.contains("未找到 RTT 控制块"));
        let multiple = describe_attach_error(
            &RttLibError::MultipleControlBlocksFound(vec![0x2000_0000, 0x2000_1000]),
            &spec,
        );
        assert!(multiple.contains("0x20000000") && multiple.contains("多个"));
        let corrupted = describe_attach_error(&RttLibError::ControlBlockCorrupted("bad".into()), &spec);
        assert!(!corrupted.contains("未找到"), "控制块损坏不应被报成未找到");
    }
}
