//! 调试模式 IPC 命令
//!
//! 调试会话使用独立的 `debug_session`（与烧录主连接和 RTT 连接互不影响）。
//! 提供 attach/detach、执行控制、内存与寄存器读取、断点和源码定位。

use crate::commands::probe::{open_session, ConnectOptions, OpenedSession};
use crate::commands::{blocking, with_session};
use crate::debug_symbols::{DebugSymbols, ElfSymbol};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, ConnectionInfo, DebugBreakpointEntry};
use probe_rs::{Core, MemoryInterface};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Response;
use tauri::State;

const HALT_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(Debug, Deserialize)]
pub struct DebugAttachOptions {
    #[serde(flatten)]
    pub connect: ConnectOptions,
    /// attach 后是否立即 halt（默认 true，符合调试场景预期）
    #[serde(default = "default_halt_after_attach")]
    pub halt_after_attach: bool,
}

fn default_halt_after_attach() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugCoreState {
    /// "halted" | "running"
    pub state: String,
    pub pc: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugStatus {
    pub attached: bool,
    pub info: Option<ConnectionInfo>,
    pub core: Option<DebugCoreState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterValue {
    pub name: String,
    pub value: u64,
}

#[derive(Debug, Deserialize)]
pub struct DebugReadMemoryOptions {
    pub address: u64,
    pub size: u32,
}

#[derive(Debug, Serialize)]
pub struct DebugLoadElfResult {
    pub path: String,
    pub function_count: usize,
    pub variable_count: usize,
    pub symbols: Vec<ElfSymbol>,
}

#[derive(Debug, Serialize)]
pub struct DebugFrame {
    pub id: u32,
    pub pc: u64,
    pub function: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct DebugBreakpointOptions {
    pub address: u64,
}

#[derive(Debug, Deserialize)]
pub struct DebugSetSourceBreakpointOptions {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Serialize)]
pub struct DebugReadSourceResult {
    pub path: String,
    pub content: String,
}

// ============================================================================
// Attach / Detach
// ============================================================================

/// 在阻塞线程里取出调试连接的 core 0 执行操作
async fn with_core<T: Send + 'static>(
    state: &AppState,
    task: impl FnOnce(&mut Core<'_>) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    with_session(&state.debug_session, move |session| {
        let mut core = session
            .core(0)
            .map_err(|e| AppError::DebugError(format!("获取核心失败: {}", e)))?;
        task(&mut core)
    })
    .await
}

fn read_pc(core: &mut Core<'_>) -> AppResult<u64> {
    let pc_reg = core
        .registers()
        .pc()
        .ok_or_else(|| AppError::DebugError("当前架构无 PC 寄存器".to_string()))?;
    core.read_core_reg(pc_reg)
        .map_err(|e| AppError::DebugError(format!("读 PC 失败: {}", e)))
}

fn read_lr(core: &mut Core<'_>) -> Option<u64> {
    let lr_reg = core
        .registers()
        .core_registers()
        .find(|r| r.name().eq_ignore_ascii_case("LR"))?;
    core.read_core_reg(lr_reg).ok()
}

fn halted_at(pc: u64) -> DebugCoreState {
    DebugCoreState {
        state: "halted".into(),
        pc: Some(pc),
    }
}

/// 在 `address` 下临时硬断点并运行，直到命中或超时后清除断点。
/// 超时说明目标没有按预期返回：主动 halt，返回实际停下的位置，
/// 保证前端看到的“已暂停”和芯片真实状态一致。
fn run_to_address(core: &mut Core<'_>, address: u64, timeout: Duration) -> AppResult<u64> {
    core.set_hw_breakpoint(address)
        .map_err(|e| AppError::DebugError(format!("设置临时断点失败: {}", e)))?;

    let run_result = core
        .run()
        .map_err(|e| AppError::DebugError(format!("run 失败: {}", e)))
        .map(|_| core.wait_for_core_halted(timeout));

    // 清掉临时断点不论成功失败
    let _ = core.clear_hw_breakpoint(address);

    if let Err(error) = run_result? {
        log::warn!("等待临时断点 0x{:08X} 命中超时: {}，已强制暂停", address, error);
        core.halt(HALT_TIMEOUT)
            .map_err(|e| AppError::DebugError(format!("halt 失败: {}", e)))?;
    }
    read_pc(core)
}

#[tauri::command]
pub async fn debug_attach(options: DebugAttachOptions, state: State<'_, AppState>) -> AppResult<DebugStatus> {
    log::info!("=== Debug attach ===");

    let slot = Arc::clone(&state.debug_session);
    let info_slot = Arc::clone(&state.debug_connection_info);
    let breakpoints = Arc::clone(&state.debug_breakpoints);
    let (info, core_state) = blocking(move || {
        // 关闭已有调试连接；硬件断点随旧连接失效，记录一并清空
        *info_slot.lock() = None;
        drop(slot.lock().take());
        breakpoints.lock().clear();

        let OpenedSession {
            mut session,
            connection_info,
            ..
        } = open_session(&options.connect)?;

        let core_state = if options.halt_after_attach {
            let mut core = session
                .core(0)
                .map_err(|e| AppError::DebugError(format!("获取核心失败: {}", e)))?;
            let info = core
                .halt(HALT_TIMEOUT)
                .map_err(|e| AppError::DebugError(format!("halt 失败: {}", e)))?;
            halted_at(info.pc)
        } else {
            DebugCoreState {
                state: "running".to_string(),
                pc: None,
            }
        };

        *slot.lock() = Some(session);
        *info_slot.lock() = Some(connection_info.clone());
        Ok((connection_info, core_state))
    })
    .await?;

    log::info!("✓ Debug attached, core 状态: {}", core_state.state);

    Ok(DebugStatus {
        attached: true,
        info: Some(info),
        core: Some(core_state),
    })
}

#[tauri::command]
pub async fn debug_detach(state: State<'_, AppState>) -> AppResult<()> {
    let slot = Arc::clone(&state.debug_session);
    let info_slot = Arc::clone(&state.debug_connection_info);
    let breakpoints = Arc::clone(&state.debug_breakpoints);
    blocking(move || {
        let previous = slot.lock().take();
        // detach 前让芯片继续跑，避免离开后还停在 halt 状态
        if let Some(mut session) = previous {
            if let Ok(mut core) = session.core(0) {
                let _ = core.run();
            }
        }
        *info_slot.lock() = None;
        // 断点只存在于这次连接的硬件里，断开后不能再展示
        breakpoints.lock().clear();
        Ok(())
    })
    .await?;
    log::info!("Debug detached");
    Ok(())
}

#[tauri::command]
pub async fn debug_get_status(state: State<'_, AppState>) -> AppResult<DebugStatus> {
    let info = state.debug_connection_info.lock().clone();
    let slot = Arc::clone(&state.debug_session);
    let (attached, core) = blocking(move || {
        let mut guard = slot.lock();
        let core_state = guard.as_mut().and_then(|session| {
            let mut core = session.core(0).ok()?;
            let halted = core.core_halted().unwrap_or(false);
            let pc = if halted { read_pc(&mut core).ok() } else { None };
            Some(DebugCoreState {
                state: if halted { "halted".into() } else { "running".into() },
                pc,
            })
        });
        Ok((guard.is_some(), core_state))
    })
    .await?;

    Ok(DebugStatus { attached, info, core })
}

// ============================================================================
// 执行控制
// ============================================================================

#[tauri::command]
pub async fn debug_run(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    with_core(&state, |core| {
        core.run()
            .map_err(|e| AppError::DebugError(format!("run 失败: {}", e)))?;
        Ok(DebugCoreState {
            state: "running".into(),
            pc: None,
        })
    })
    .await
}

#[tauri::command]
pub async fn debug_halt(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    with_core(&state, |core| {
        let info = core
            .halt(HALT_TIMEOUT)
            .map_err(|e| AppError::DebugError(format!("halt 失败: {}", e)))?;
        Ok(halted_at(info.pc))
    })
    .await
}

#[tauri::command]
pub async fn debug_step_in(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    with_core(&state, |core| {
        let info = core
            .step()
            .map_err(|e| AppError::DebugError(format!("step 失败: {}", e)))?;
        Ok(halted_at(info.pc))
    })
    .await
}

/// 行级 step over：从当前 source line 出发，单步执行直到 file:line 改变。
/// 单步进入了被调函数时，在返回地址下临时断点跑回来，真正跨过调用。
/// 没加载 ELF / DWARF 行表里没匹配时退化为 step_in。
/// 上限 8000 条指令防失控。
#[tauri::command]
pub async fn debug_step_over(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    const MAX_STEPS: usize = 8000;
    const CALL_RETURN_TIMEOUT: Duration = Duration::from_secs(5);

    let symbols = Arc::clone(&state.debug_symbols);
    with_core(&state, move |core| {
        let starting_pc = read_pc(core)?;

        let sym_guard = symbols.lock();
        let Some(syms) = sym_guard.as_ref() else {
            // 没有符号信息：退化为 step_in
            let info = core
                .step()
                .map_err(|e| AppError::DebugError(format!("step 失败: {}", e)))?;
            return Ok(halted_at(info.pc));
        };
        let start = syms.resolve(starting_pc);

        let mut last_pc = starting_pc;
        for _ in 0..MAX_STEPS {
            let info = core
                .step()
                .map_err(|e| AppError::DebugError(format!("step 失败: {}", e)))?;
            last_pc = info.pc;
            let mut loc = syms.resolve(last_pc);

            if loc.function != start.function {
                // 刚执行完调用指令时 LR 指回当前函数：跑到返回地址，跨过整个调用
                let return_addr = read_lr(core).map(|lr| lr & !1u64).filter(|&addr| addr != 0);
                match return_addr {
                    Some(addr) if syms.resolve(addr).function == start.function => {
                        last_pc = run_to_address(core, addr, CALL_RETURN_TIMEOUT)?;
                        if last_pc != addr {
                            // 超时被强制暂停，停在哪里就报告哪里
                            break;
                        }
                        loc = syms.resolve(last_pc);
                    }
                    // 函数返回、尾调用等：已离开当前作用域，停下
                    _ => break,
                }
            }

            // file 或 line 改变 → 算"下一行"
            if loc.file != start.file || loc.line != start.line {
                break;
            }
        }

        Ok(halted_at(last_pc))
    })
    .await
}

/// step out：在 LR 处下临时硬断点，run，等待命中后清除断点。
/// 5 秒超时，超时后强制暂停并返回实际位置。
#[tauri::command]
pub async fn debug_step_out(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    with_core(&state, |core| {
        let lr =
            read_lr(core).ok_or_else(|| AppError::DebugError("当前架构未暴露 LR 寄存器，无法 step out".to_string()))?;
        // ARM Thumb: LR 最低位为 1 表示 thumb，硬断点地址必须清零最低位。
        // 异常处理函数里 LR 是 EXC_RETURN（0xFFFFFFxx），不是可下断点的地址。
        if lr >= 0xFFFF_FF00 {
            return Err(AppError::DebugError(
                "当前处于异常处理函数中（LR 为 EXC_RETURN），暂不支持 step out".to_string(),
            ));
        }
        let pc = run_to_address(core, lr & !1u64, Duration::from_secs(5))?;
        Ok(halted_at(pc))
    })
    .await
}

#[tauri::command]
pub async fn debug_reset(state: State<'_, AppState>) -> AppResult<DebugCoreState> {
    with_core(&state, |core| {
        core.reset()
            .map_err(|e| AppError::DebugError(format!("reset 失败: {}", e)))?;
        Ok(DebugCoreState {
            state: "running".into(),
            pc: None,
        })
    })
    .await
}

// ============================================================================
// 内存读写
// ============================================================================

/// 返回原始字节（二进制 IPC），前端收到的是 ArrayBuffer
#[tauri::command]
pub async fn debug_read_memory(options: DebugReadMemoryOptions, state: State<'_, AppState>) -> AppResult<Response> {
    const MAX_READ: u32 = 1024 * 1024;
    if options.size > MAX_READ {
        return Err(AppError::InvalidInput(format!(
            "内存读取大小 {} 字节超过最大限制 1MB",
            options.size
        )));
    }

    let data = with_core(&state, move |core| {
        let mut data = vec![0u8; options.size as usize];
        core.read_8(options.address, &mut data)
            .map_err(|e| AppError::MemoryError(e.to_string()))?;
        Ok(data)
    })
    .await?;
    Ok(Response::new(data))
}

// ============================================================================
// 寄存器读写
// ============================================================================

#[tauri::command]
pub async fn debug_read_registers(state: State<'_, AppState>) -> AppResult<Vec<RegisterValue>> {
    with_core(&state, |core| {
        // 必须 halt 才能稳定读寄存器
        if !core.core_halted().unwrap_or(false) {
            return Err(AppError::DebugError(
                "核心当前正在运行，需先 halt 才能读寄存器".to_string(),
            ));
        }

        let register_file = core.registers();
        let mut registers: Vec<RegisterValue> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut push = |name: String, value: u64| {
            if seen.insert(name.clone()) {
                registers.push(RegisterValue { name, value });
            }
        };

        if let Some(pc) = register_file.pc() {
            if let Ok(value) = core.read_core_reg(pc) {
                push("PC".to_string(), value);
            }
        }
        for reg in register_file.core_registers() {
            if let Ok(value) = core.read_core_reg(reg) {
                push(reg.name().to_string(), value);
            }
        }
        for i in 0..4 {
            let reg = register_file.argument_register(i);
            if let Ok(value) = core.read_core_reg(reg) {
                push(reg.name().to_string(), value);
            }
        }

        Ok(registers)
    })
    .await
}

// ============================================================================
// ELF / DWARF 符号
// ============================================================================

#[tauri::command]
pub async fn debug_load_elf(path: String, state: State<'_, AppState>) -> AppResult<DebugLoadElfResult> {
    // 大 ELF 的 DWARF 解析要几百毫秒到几秒，放到阻塞线程
    let symbols = blocking(move || DebugSymbols::load(&path).map_err(AppError::DebugError)).await?;
    let summary = symbols.summary();
    let symbol_list = symbols.symbols.clone();
    *state.debug_symbols.lock() = Some(symbols);
    log::info!(
        "ELF loaded: {} ({} 函数 / {} 变量)",
        summary.path,
        summary.function_count,
        summary.variable_count
    );
    Ok(DebugLoadElfResult {
        path: summary.path,
        function_count: summary.function_count,
        variable_count: summary.variable_count,
        symbols: symbol_list,
    })
}

#[tauri::command]
pub async fn debug_clear_symbols(state: State<'_, AppState>) -> AppResult<()> {
    let mut guard = state.debug_symbols.lock();
    *guard = None;
    Ok(())
}

// ============================================================================
// 断点
// ============================================================================

/// 在指定地址设硬断点，并把记录加入跟踪列表（幂等）。
/// `source` 可选：源码断点会带 (file, line)，按地址加的断点为 None。
async fn register_breakpoint(
    state: &AppState,
    address: u64,
    source: Option<(String, u32)>,
) -> AppResult<DebugBreakpointEntry> {
    with_core(state, move |core| {
        core.set_hw_breakpoint(address)
            .map_err(|e| AppError::DebugError(format!("设置断点失败: {}", e)))
    })
    .await?;

    let mut bp_guard = state.debug_breakpoints.lock();
    if let Some(existing) = bp_guard.iter_mut().find(|b| b.address == address) {
        // 重复设置：保留已有记录，仅在原本无 source 时补充 source 信息
        if let Some((file, line)) = source {
            if existing.file.is_none() {
                existing.file = Some(file);
                existing.line = Some(line);
            }
        }
        return Ok(existing.clone());
    }
    let id = bp_guard.iter().map(|b| b.id).max().unwrap_or(0) + 1;
    let (file, line) = match source {
        Some((f, l)) => (Some(f), Some(l)),
        None => (None, None),
    };
    let entry = DebugBreakpointEntry {
        id,
        address,
        enabled: true,
        hit_count: 0,
        file,
        line,
    };
    bp_guard.push(entry.clone());
    log::info!("断点已设置: 0x{:08X} (id={})", address, id);
    Ok(entry)
}

#[tauri::command]
pub async fn debug_set_breakpoint(
    options: DebugBreakpointOptions,
    state: State<'_, AppState>,
) -> AppResult<DebugBreakpointEntry> {
    register_breakpoint(&state, options.address, None).await
}

#[tauri::command]
pub async fn debug_set_source_breakpoint(
    options: DebugSetSourceBreakpointOptions,
    state: State<'_, AppState>,
) -> AppResult<DebugBreakpointEntry> {
    let address = {
        let guard = state.debug_symbols.lock();
        let symbols = guard
            .as_ref()
            .ok_or_else(|| AppError::DebugError("未加载 ELF".to_string()))?;
        symbols.lookup_addr(&options.file, options.line).ok_or_else(|| {
            AppError::DebugError(format!(
                "DWARF 行表中找不到 {}:{} 对应的指令地址（可能此行不是语句开头或被优化）",
                options.file, options.line
            ))
        })?
    };
    register_breakpoint(&state, address, Some((options.file, options.line))).await
}

#[tauri::command]
pub async fn debug_clear_breakpoint(options: DebugBreakpointOptions, state: State<'_, AppState>) -> AppResult<()> {
    let address = options.address;
    with_core(&state, move |core| {
        core.clear_hw_breakpoint(address)
            .map_err(|e| AppError::DebugError(format!("清除断点失败: {}", e)))
    })
    .await?;

    state.debug_breakpoints.lock().retain(|b| b.address != address);
    log::info!("断点已清除: 0x{:08X}", address);
    Ok(())
}

#[tauri::command]
pub async fn debug_list_breakpoints(state: State<'_, AppState>) -> AppResult<Vec<DebugBreakpointEntry>> {
    Ok(state.debug_breakpoints.lock().clone())
}

#[tauri::command]
pub async fn debug_clear_all_breakpoints(state: State<'_, AppState>) -> AppResult<()> {
    let addresses: Vec<u64> = state.debug_breakpoints.lock().iter().map(|b| b.address).collect();
    let count = addresses.len();

    // 尽力清除硬件断点；未连接或核心不可用时断点已随连接失效，只需清空记录
    let _ = with_core(&state, move |core| {
        for addr in &addresses {
            let _ = core.clear_hw_breakpoint(*addr);
        }
        Ok(())
    })
    .await;

    state.debug_breakpoints.lock().clear();
    log::info!("已清除全部 {} 个断点", count);
    Ok(())
}

// ============================================================================
// 源码读取
// ============================================================================

#[tauri::command]
pub async fn debug_read_source(path: String) -> AppResult<DebugReadSourceResult> {
    use std::path::Path;
    const MAX_SOURCE_SIZE: u64 = 4 * 1024 * 1024; // 4MB 上限

    let p = Path::new(&path);
    if !is_source_file(p) {
        return Err(AppError::InvalidInput(format!("不支持读取该类型的文件: {}", path)));
    }
    if !p.exists() {
        return Err(AppError::DebugError(format!("源文件不存在: {}", path)));
    }
    let metadata = std::fs::metadata(p).map_err(|e| AppError::DebugError(format!("无法读取源文件元数据: {}", e)))?;
    if metadata.len() > MAX_SOURCE_SIZE {
        return Err(AppError::DebugError(format!(
            "源文件过大 ({} 字节)，超过 4MB 上限",
            metadata.len()
        )));
    }

    let content = std::fs::read_to_string(p).map_err(|e| AppError::DebugError(format!("读源文件失败: {}", e)))?;
    Ok(DebugReadSourceResult { path, content })
}

/// 源码视图只需要读取 C/C++/汇编源码和头文件
fn is_source_file(path: &std::path::Path) -> bool {
    const SOURCE_EXTENSIONS: &[&str] = &[
        "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "inl", "s", "asm", "inc", "rs",
    ];
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| SOURCE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// 调用栈：当前 PC（必出）+ 由 LR 推出来的调用者（如果 LR 非零、非 PC
/// 自身且能取到）。受限于不做 .debug_frame 解栈，深度限于 2 帧；
/// 真实 N 帧展开是阶段 6 的事。
#[tauri::command]
pub async fn debug_get_call_stack(state: State<'_, AppState>) -> AppResult<Vec<DebugFrame>> {
    let registers = with_core(&state, |core| {
        if !core.core_halted().unwrap_or(false) {
            return Ok(None);
        }
        // LR 可能拿不到（架构无）或读取失败：失败就只回单帧
        Ok(Some((read_pc(core)?, read_lr(core))))
    })
    .await?;
    let Some((pc, lr)) = registers else {
        return Ok(Vec::new());
    };

    let symbols_guard = state.debug_symbols.lock();
    let symbols = symbols_guard.as_ref();

    let mut frames = Vec::with_capacity(2);
    let l0 = symbols.map(|s| s.resolve(pc)).unwrap_or_default();
    frames.push(DebugFrame {
        id: 0,
        pc,
        function: l0.function,
        file: l0.file,
        line: l0.line,
    });

    if let Some(lr) = lr {
        // ARM Thumb: LR 最低位 = 1 表示 thumb；解析地址需清零
        let return_addr = lr & !1u64;
        // 跳过明显无效的 LR：0（启动初态 / Cortex-M reset）、与 PC 相同
        if return_addr != 0 && return_addr != pc {
            let l1 = symbols.map(|s| s.resolve(return_addr)).unwrap_or_default();
            frames.push(DebugFrame {
                id: 1,
                pc: return_addr,
                function: l1.function,
                file: l1.file,
                line: l1.line,
            });
        }
    }

    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::is_source_file;
    use std::path::Path;

    #[test]
    fn only_source_extensions_are_readable() {
        assert!(is_source_file(Path::new("/proj/src/main.c")));
        assert!(is_source_file(Path::new("/proj/startup.S")));
        assert!(!is_source_file(Path::new("/home/user/.ssh/id_rsa")));
        assert!(!is_source_file(Path::new("/etc/passwd")));
    }
}
