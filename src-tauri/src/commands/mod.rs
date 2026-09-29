pub mod ble;
pub mod config;
pub mod debug;
pub mod export;
pub mod flash;
pub mod probe;
pub mod rtt;
pub mod serial;

use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use probe_rs::Session;
use std::sync::Arc;

pub(crate) type SharedSession = Arc<Mutex<Option<Session>>>;

/// 把探针 USB 往返、文件解析等同步阻塞操作放到阻塞线程池执行。
///
/// Tauri 的 async 命令跑在 tokio worker 上，直接阻塞几秒（烧录、attach、扫描 RTT）
/// 会占满 worker，连带串口/RTT/BLE 的事件上报一起停住。
pub(crate) async fn blocking<T: Send + 'static>(task: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| AppError::ConfigError(format!("后台任务异常: {}", e)))?
}

/// 在阻塞线程里取出已连接的 session 执行操作；未连接返回 `NotConnected`
pub(crate) async fn with_session<T: Send + 'static>(
    slot: &SharedSession,
    task: impl FnOnce(&mut Session) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let slot = Arc::clone(slot);
    blocking(move || {
        let mut guard = slot.lock();
        let session = guard.as_mut().ok_or(AppError::NotConnected)?;
        task(session)
    })
    .await
}
