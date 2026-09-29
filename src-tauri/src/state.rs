use crate::debug_symbols::DebugSymbols;
use parking_lot::Mutex;
use probe_rs::Session;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

/// 采集循环（串口读线程、RTT 轮询）的运行代次。
///
/// 每次启动分配新代次，停止时代次也会前进；旧循环发现代次变化就退出，
/// 这样快速“停止→启动”时不会出现新旧两个循环同时读同一个数据源，
/// 旧循环退出时也无法把新循环的状态改成已停止。
/// 低位表示是否运行，其余位是代次，放在同一个原子量里保证读写一致。
#[derive(Default)]
pub struct RunGeneration(AtomicU64);

impl RunGeneration {
    /// 开始新一轮运行，返回本轮代次
    pub fn start(&self) -> u64 {
        let previous = self
            .0
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| Some(((v >> 1) + 1) << 1 | 1))
            .unwrap_or_default();
        (previous >> 1) + 1
    }

    /// 停止当前运行（任何代次的循环都会在下一轮检查时退出）
    pub fn stop(&self) {
        let _ = self
            .0
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| Some(((v >> 1) + 1) << 1));
    }

    pub fn is_running(&self) -> bool {
        self.0.load(Ordering::SeqCst) & 1 == 1
    }

    /// 该代次是否仍是正在运行的那一轮
    pub fn is_current(&self, generation: u64) -> bool {
        self.0.load(Ordering::SeqCst) == generation << 1 | 1
    }

    /// 循环自行结束时调用：只有仍是当前代次才会标记为停止
    pub fn finish(&self, generation: u64) -> bool {
        self.0
            .compare_exchange(generation << 1 | 1, generation << 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

/// RTT 运行时状态
#[derive(Default)]
pub struct RttState {
    pub run: RunGeneration,
}

impl RttState {
    pub fn is_running(&self) -> bool {
        self.run.is_running()
    }
}

// ============================================================================
// Serial Port Types and Traits
// ============================================================================

/// Serial connection statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SerialStats {
    pub bytes_received: u64,
    pub bytes_sent: u64,
}

/// Data source trait for serial communication (synchronous)
pub trait DataSource: Send {
    /// Connect to the data source
    fn connect(&mut self) -> Result<(), String>;

    /// Disconnect from the data source
    fn disconnect(&mut self) -> Result<(), String>;

    /// Write data to the data source
    fn write(&mut self, data: &[u8]) -> Result<usize, String>;

    /// Read data from the data source (non-blocking)
    fn read(&mut self, buf: &mut [u8]) -> Result<usize, String>;

    /// Check if the data source is connected
    fn is_connected(&self) -> bool;

    /// Get the name of the data source
    fn name(&self) -> String;

    /// Get statistics
    fn stats(&self) -> SerialStats;

    /// Reset statistics
    fn reset_stats(&mut self);

    /// 该数据源是否希望在断线时由轮询任务尝试自动重连
    fn wants_reconnect(&self) -> bool {
        false
    }
}

/// Serial port runtime state
pub struct SerialState {
    /// 读线程运行代次
    pub run: RunGeneration,
    /// Data source instance
    pub datasource: Mutex<Option<Box<dyn DataSource>>>,
    /// 文件发送期间阻止普通写入，避免协议帧与用户命令交错。
    file_transfer_active: AtomicBool,
    /// X/Y/ZMODEM 需要独占接收控制字节；原始发送仍允许普通 RX。
    file_transfer_exclusive: AtomicBool,
    file_transfer_cancelled: AtomicBool,
}

impl Default for SerialState {
    fn default() -> Self {
        Self {
            run: RunGeneration::default(),
            datasource: Mutex::new(None),
            file_transfer_active: AtomicBool::new(false),
            file_transfer_exclusive: AtomicBool::new(false),
            file_transfer_cancelled: AtomicBool::new(false),
        }
    }
}

impl SerialState {
    pub fn is_running(&self) -> bool {
        self.run.is_running()
    }

    pub fn is_connected(&self) -> bool {
        self.datasource
            .lock()
            .as_ref()
            .map(|ds| ds.is_connected())
            .unwrap_or(false)
    }

    pub fn begin_file_transfer(&self, exclusive: bool) -> Result<(), String> {
        self.file_transfer_active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "已有文件正在发送".to_string())?;
        self.file_transfer_cancelled.store(false, Ordering::SeqCst);
        self.file_transfer_exclusive.store(exclusive, Ordering::SeqCst);
        Ok(())
    }

    pub fn finish_file_transfer(&self) {
        self.file_transfer_exclusive.store(false, Ordering::SeqCst);
        self.file_transfer_active.store(false, Ordering::SeqCst);
        self.file_transfer_cancelled.store(false, Ordering::SeqCst);
    }

    pub fn cancel_file_transfer(&self) -> bool {
        if !self.is_file_transferring() {
            return false;
        }
        self.file_transfer_cancelled.store(true, Ordering::SeqCst);
        true
    }

    pub fn is_file_transferring(&self) -> bool {
        self.file_transfer_active.load(Ordering::SeqCst)
    }

    pub fn is_file_transfer_exclusive(&self) -> bool {
        self.file_transfer_exclusive.load(Ordering::SeqCst)
    }

    pub fn file_transfer_cancelled(&self) -> bool {
        self.file_transfer_cancelled.load(Ordering::SeqCst)
    }

    pub fn get_stats(&self) -> SerialStats {
        self.datasource.lock().as_ref().map(|ds| ds.stats()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::RunGeneration;

    #[test]
    fn stale_generation_cannot_stop_new_run() {
        let run = RunGeneration::default();
        let first = run.start();
        run.stop();
        let second = run.start();
        assert!(!run.is_current(first));
        assert!(run.is_current(second));
        assert!(!run.finish(first), "旧循环退出不应影响新一轮");
        assert!(run.is_running());
        assert!(run.finish(second));
        assert!(!run.is_running());
    }

    #[test]
    fn restart_without_stop_retires_previous_generation() {
        let run = RunGeneration::default();
        let first = run.start();
        let second = run.start();
        assert_ne!(first, second);
        assert!(!run.is_current(first));
        assert!(run.is_current(second));
    }
}

// ============================================================================
// Application State
// ============================================================================

pub struct AppState {
    pub session: Arc<Mutex<Option<Session>>>,            // 主连接（用于烧录）
    pub rtt_session: Arc<Mutex<Option<Session>>>,        // RTT 独立连接
    pub debug_session: Arc<Mutex<Option<Session>>>,      // 调试独立连接
    pub debug_symbols: Arc<Mutex<Option<DebugSymbols>>>, // 当前加载的 ELF/DWARF 缓存
    pub debug_breakpoints: Arc<Mutex<Vec<DebugBreakpointEntry>>>, // 已注册的硬断点
    pub connection_info: Arc<Mutex<Option<ConnectionInfo>>>,
    pub rtt_connection_info: Arc<Mutex<Option<ConnectionInfo>>>, // RTT 连接信息
    pub debug_connection_info: Arc<Mutex<Option<ConnectionInfo>>>, // 调试连接信息
    pub settings: Arc<Mutex<DeviceSettings>>,
    pub rtt_state: Arc<RttState>,
    pub serial_state: Arc<SerialState>, // Serial port state
    pub ai_bridge_state: Arc<crate::ai_bridge::AiBridgeState>,
    pub ble_state: crate::ble::SharedBleState, // BLE 蓝牙状态
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            rtt_session: Arc::new(Mutex::new(None)),
            debug_session: Arc::new(Mutex::new(None)),
            debug_symbols: Arc::new(Mutex::new(None)),
            debug_breakpoints: Arc::new(Mutex::new(Vec::new())),
            connection_info: Arc::new(Mutex::new(None)),
            rtt_connection_info: Arc::new(Mutex::new(None)),
            debug_connection_info: Arc::new(Mutex::new(None)),
            settings: Arc::new(Mutex::new(DeviceSettings::default())),
            rtt_state: Arc::new(RttState::default()),
            serial_state: Arc::new(SerialState::default()),
            ai_bridge_state: Arc::new(crate::ai_bridge::AiBridgeState::default()),
            ble_state: Arc::new(crate::ble::BleState::default()),
        }
    }
}

/// 已注册的硬断点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugBreakpointEntry {
    pub id: u32,
    pub address: u64,
    pub enabled: bool,
    pub hit_count: u64,
    /// 源码断点会带源文件路径与行号；按地址加的断点这两项为 None
    pub file: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub probe_name: String,
    pub probe_serial: Option<String>, // 新增：DAP探针序列号
    pub target_name: String,
    pub core_type: String,
    pub chip_id: Option<u32>,       // 芯片DBGMCU_IDCODE
    pub target_idcode: Option<u32>, // 新增：目标芯片的真实IDCODE（通过SWD读取）
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceSettings {
    pub interface_type: InterfaceType,
    pub clock_speed: u32,
    pub connect_mode: ConnectMode,
    pub reset_mode: ResetMode,
    pub voltage: f32,
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            interface_type: InterfaceType::Swd,
            clock_speed: 1000000, // 1MHz
            connect_mode: ConnectMode::Normal,
            reset_mode: ResetMode::Software,
            voltage: 3.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum InterfaceType {
    Swd,
    Jtag,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectMode {
    Normal,
    UnderReset,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ResetMode {
    Software,
    Hardware,
}
