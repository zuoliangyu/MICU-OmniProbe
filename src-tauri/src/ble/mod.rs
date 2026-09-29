//! BLE 蓝牙数据源模块
//!
//! 基于 btleplug 实现跨平台 BLE 扫描、连接、服务发现、notify 订阅与写入。
//! 数据流仿照 serial 模块：notify 事件经后台任务批处理后通过 `ble-data` 事件 emit 到前端。

use parking_lot::Mutex as PlMutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use btleplug::api::Manager as _;
use btleplug::platform::{Adapter, Manager, Peripheral};

/// Nordic UART Service UUID
pub const NUS_SERVICE_UUID: Uuid = Uuid::from_u128(0x6E400001_B5A3_F393_E0A9_E50E24DCCA9E);
/// Nordic UART RX 特征（手机/上位机往设备写）
pub const NUS_RX_CHAR_UUID: Uuid = Uuid::from_u128(0x6E400002_B5A3_F393_E0A9_E50E24DCCA9E);
/// Nordic UART TX 特征（设备发往上位机的 notify）
pub const NUS_TX_CHAR_UUID: Uuid = Uuid::from_u128(0x6E400003_B5A3_F393_E0A9_E50E24DCCA9E);

/// 扫描到的 BLE 设备摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleDeviceInfo {
    /// 设备唯一标识（btleplug PeripheralId 字符串形式）
    pub id: String,
    /// MAC 地址（部分平台不可用时为空字符串）
    pub address: String,
    /// 广播名称
    pub name: Option<String>,
    /// 信号强度（dBm）
    pub rssi: Option<i16>,
    /// 是否已连接
    pub connected: bool,
}

/// 特征值属性
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BleCharacteristicProperties {
    pub read: bool,
    pub write: bool,
    pub write_without_response: bool,
    pub notify: bool,
    pub indicate: bool,
}

/// BLE 特征值描述
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleCharacteristic {
    pub uuid: String,
    pub properties: BleCharacteristicProperties,
}

/// BLE 服务描述
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BleService {
    pub uuid: String,
    pub characteristics: Vec<BleCharacteristic>,
}

/// 自动识别的 NUS 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NusAutoConfig {
    pub service_uuid: String,
    pub notify_char_uuid: String,
    pub write_char_uuid: String,
}

/// BLE 收发字节计数
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BleStats {
    pub bytes_received: u64,
    pub bytes_sent: u64,
}

/// BLE 运行时状态（通过 AppState 共享）
pub struct BleState {
    /// btleplug Manager（懒加载）
    pub manager: AsyncMutex<Option<Manager>>,
    /// 默认适配器
    pub adapter: AsyncMutex<Option<Adapter>>,
    /// 扫描发现的 peripherals 缓存：device_id -> Peripheral
    pub peripherals: AsyncMutex<HashMap<String, Peripheral>>,
    /// 当前连接的 peripheral
    pub connected: AsyncMutex<Option<Peripheral>>,
    /// 当前连接设备元信息
    pub connected_info: PlMutex<Option<BleDeviceInfo>>,
    /// 是否正在扫描
    pub scanning: AtomicBool,
    /// 提前结束当前扫描（`ble_stop_scan` 触发）
    pub scan_cancel: tokio::sync::Notify,
    /// 是否正在订阅 notify
    pub notify_running: AtomicBool,
    /// 收发统计
    pub stats: PlMutex<BleStats>,
    /// notify 后台任务句柄
    pub notify_task: PlMutex<Option<tokio::task::JoinHandle<()>>>,
    /// 当前订阅的特征值 UUID
    pub subscribed_char: PlMutex<Option<Uuid>>,
    /// 监听适配器断线事件的后台任务句柄
    pub disconnect_watch: PlMutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Default for BleState {
    fn default() -> Self {
        Self {
            manager: AsyncMutex::new(None),
            adapter: AsyncMutex::new(None),
            peripherals: AsyncMutex::new(HashMap::new()),
            connected: AsyncMutex::new(None),
            connected_info: PlMutex::new(None),
            scanning: AtomicBool::new(false),
            scan_cancel: tokio::sync::Notify::new(),
            notify_running: AtomicBool::new(false),
            stats: PlMutex::new(BleStats::default()),
            notify_task: PlMutex::new(None),
            subscribed_char: PlMutex::new(None),
            disconnect_watch: PlMutex::new(None),
        }
    }
}

impl BleState {
    pub fn is_scanning(&self) -> bool {
        self.scanning.load(Ordering::SeqCst)
    }

    /// 原子地进入扫描状态；已在扫描中返回 false
    pub fn try_begin_scan(&self) -> bool {
        self.scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn set_scanning(&self, value: bool) {
        self.scanning.store(value, Ordering::SeqCst);
    }

    pub fn is_notify_running(&self) -> bool {
        self.notify_running.load(Ordering::SeqCst)
    }

    pub fn set_notify_running(&self, value: bool) {
        self.notify_running.store(value, Ordering::SeqCst);
    }

    pub fn add_rx(&self, n: u64) {
        self.stats.lock().bytes_received += n;
    }

    pub fn add_tx(&self, n: u64) {
        self.stats.lock().bytes_sent += n;
    }

    pub fn reset_stats(&self) {
        *self.stats.lock() = BleStats::default();
    }
}

/// 共享类型：跨命令传递的 Arc<BleState>
pub type SharedBleState = Arc<BleState>;

/// 懒加载初始化 manager 和默认 adapter
pub async fn ensure_adapter(state: &SharedBleState) -> Result<Adapter, String> {
    {
        let guard = state.adapter.lock().await;
        if let Some(adapter) = guard.as_ref() {
            return Ok(adapter.clone());
        }
    }

    let manager = Manager::new()
        .await
        .map_err(|e| format!("初始化 BLE Manager 失败: {}", e))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|e| format!("枚举蓝牙适配器失败: {}", e))?;
    let adapter = adapters
        .into_iter()
        .next()
        .ok_or_else(|| "未找到可用的蓝牙适配器".to_string())?;

    *state.manager.lock().await = Some(manager);
    *state.adapter.lock().await = Some(adapter.clone());

    Ok(adapter)
}
