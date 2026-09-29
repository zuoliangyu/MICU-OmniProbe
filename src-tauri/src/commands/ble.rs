//! BLE 蓝牙命令
//!
//! 扫描、连接、服务发现、订阅 notify、写入。
//! 数据流仿照 serial 模块：notify 事件经后台任务批处理 emit `ble-data`，状态变化 emit `ble-status`。

use btleplug::api::{Central, CentralEvent, CharPropFlags, Peripheral as _, ScanFilter, WriteType};
use futures::stream::StreamExt;
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::ble::{
    ensure_adapter, BleCharacteristic, BleCharacteristicProperties, BleDeviceInfo, BleService, NusAutoConfig,
    NUS_RX_CHAR_UUID, NUS_SERVICE_UUID, NUS_TX_CHAR_UUID,
};
use crate::state::AppState;

// ============================================================================
// 事件 payload
// ============================================================================

#[derive(Clone, Serialize)]
struct BleDataChunk {
    data: Vec<u8>,
    timestamp: i64,
}

#[derive(Clone, Serialize)]
struct BleDataEvent {
    chunks: Vec<BleDataChunk>,
    direction: String,
}

#[derive(Clone, Serialize)]
struct BleStatusEvent {
    connected: bool,
    running: bool,
    error: Option<String>,
}

// ============================================================================
// 扫描
// ============================================================================

#[tauri::command]
pub async fn ble_start_scan(timeout_ms: Option<u64>, state: State<'_, AppState>) -> Result<Vec<BleDeviceInfo>, String> {
    let ble = state.ble_state.clone();
    let adapter = ensure_adapter(&ble).await?;

    // 先登记取消通知再进入扫描状态：ble_stop_scan 只要看到“扫描中”就一定能唤醒这里
    let cancelled = ble.scan_cancel.notified();
    tokio::pin!(cancelled);
    cancelled.as_mut().enable();
    if !ble.try_begin_scan() {
        return Err("已在扫描中".into());
    }

    if let Err(e) = adapter.start_scan(ScanFilter::default()).await {
        ble.set_scanning(false);
        return Err(format!("启动扫描失败: {}", e));
    }

    let timeout = timeout_ms.unwrap_or(5000).clamp(500, 30000);
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(timeout)) => {}
        _ = cancelled => {}
    }

    let _ = adapter.stop_scan().await;
    ble.set_scanning(false);

    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|e| format!("获取设备列表失败: {}", e))?;

    let mut cache = ble.peripherals.lock().await;
    cache.clear();

    let mut results: Vec<BleDeviceInfo> = Vec::new();
    for p in peripherals {
        let id_str = p.id().to_string();
        let address = p.address().to_string();
        let props = p.properties().await.ok().flatten();
        let name = props.as_ref().and_then(|pp| pp.local_name.clone());
        let rssi = props.as_ref().and_then(|pp| pp.rssi);
        let connected = p.is_connected().await.unwrap_or(false);

        results.push(BleDeviceInfo {
            id: id_str.clone(),
            address,
            name,
            rssi,
            connected,
        });
        cache.insert(id_str, p);
    }

    // 排序：有名字的优先，再按信号强度
    results.sort_by(|a, b| {
        let an = a.name.is_some();
        let bn = b.name.is_some();
        bn.cmp(&an)
            .then_with(|| b.rssi.unwrap_or(-127).cmp(&a.rssi.unwrap_or(-127)))
    });

    Ok(results)
}

#[tauri::command]
pub async fn ble_stop_scan(state: State<'_, AppState>) -> Result<(), String> {
    let ble = state.ble_state.clone();
    if ble.is_scanning() {
        // 让正在等待的 ble_start_scan 提前结束，由它停止扫描并返回已发现的设备
        ble.scan_cancel.notify_waiters();
    } else {
        let adapter = ensure_adapter(&ble).await?;
        let _ = adapter.stop_scan().await;
    }
    Ok(())
}

// ============================================================================
// 连接 / 断开
// ============================================================================

#[tauri::command]
pub async fn ble_connect(
    device_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BleDeviceInfo, String> {
    let ble = state.ble_state.clone();
    let adapter = ensure_adapter(&ble).await?;

    // 先停掉旧的订阅并断开旧连接
    release_connection(&ble).await;

    // 找到对应 peripheral
    let peripheral = {
        let cache = ble.peripherals.lock().await;
        cache.get(&device_id).cloned()
    };
    let peripheral = match peripheral {
        Some(p) => p,
        None => adapter
            .peripherals()
            .await
            .map_err(|e| format!("获取设备列表失败: {}", e))?
            .into_iter()
            .find(|p| p.id().to_string() == device_id)
            .ok_or_else(|| format!("未找到设备: {}", device_id))?,
    };

    peripheral.connect().await.map_err(|e| format!("连接失败: {}", e))?;
    peripheral
        .discover_services()
        .await
        .map_err(|e| format!("服务发现失败: {}", e))?;

    let address = peripheral.address().to_string();
    let props = peripheral.properties().await.ok().flatten();
    let name = props.as_ref().and_then(|pp| pp.local_name.clone());
    let rssi = props.as_ref().and_then(|pp| pp.rssi);

    let info = BleDeviceInfo {
        id: device_id,
        address,
        name,
        rssi,
        connected: true,
    };

    let peripheral_id = peripheral.id();
    *ble.connected.lock().await = Some(peripheral);
    *ble.connected_info.lock() = Some(info.clone());
    ble.reset_stats();
    watch_disconnect(&ble, &adapter, peripheral_id, app.clone()).await;

    let _ = app.emit(
        "ble-status",
        BleStatusEvent {
            connected: true,
            running: false,
            error: None,
        },
    );

    Ok(info)
}

#[tauri::command]
pub async fn ble_disconnect(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let ble = state.ble_state.clone();
    release_connection(&ble).await;

    let _ = app.emit(
        "ble-status",
        BleStatusEvent {
            connected: false,
            running: false,
            error: None,
        },
    );

    Ok(())
}

/// 停止订阅、结束断线监听并断开当前连接
async fn release_connection(ble: &crate::ble::SharedBleState) {
    if let Some(handle) = ble.disconnect_watch.lock().take() {
        handle.abort();
    }
    stop_notify(ble).await;
    let previous = ble.connected.lock().await.take();
    if let Some(p) = previous {
        let _ = p.disconnect().await;
    }
    *ble.connected_info.lock() = None;
}

/// 监听适配器事件：设备意外掉线时清理连接状态并通知前端，避免 UI 一直显示“已连接”
async fn watch_disconnect(
    ble: &crate::ble::SharedBleState,
    adapter: &btleplug::platform::Adapter,
    peripheral_id: btleplug::platform::PeripheralId,
    app: AppHandle,
) {
    let mut events = match adapter.events().await {
        Ok(events) => events,
        Err(e) => {
            log::warn!("无法订阅蓝牙适配器事件，掉线将无法自动检测: {}", e);
            return;
        }
    };
    let ble_clone = ble.clone();
    let handle = tokio::spawn(async move {
        while let Some(event) = events.next().await {
            if matches!(&event, CentralEvent::DeviceDisconnected(id) if *id == peripheral_id) {
                // 本任务就是 disconnect_watch，自己不需要 abort
                ble_clone.disconnect_watch.lock().take();
                stop_notify(&ble_clone).await;
                ble_clone.connected.lock().await.take();
                *ble_clone.connected_info.lock() = None;
                let _ = app.emit(
                    "ble-status",
                    BleStatusEvent {
                        connected: false,
                        running: false,
                        error: Some("BLE 设备已断开连接".to_string()),
                    },
                );
                break;
            }
        }
    });
    *ble.disconnect_watch.lock() = Some(handle);
}

// ============================================================================
// 服务 / 特征值
// ============================================================================

#[tauri::command]
pub async fn ble_list_services(state: State<'_, AppState>) -> Result<Vec<BleService>, String> {
    let ble = state.ble_state.clone();
    let peripheral = {
        let guard = ble.connected.lock().await;
        guard.clone().ok_or_else(|| "未连接 BLE 设备".to_string())?
    };

    let services = peripheral.services();
    let mut result = Vec::new();
    for service in services {
        let mut chars = Vec::new();
        for ch in &service.characteristics {
            chars.push(BleCharacteristic {
                uuid: ch.uuid.to_string(),
                properties: BleCharacteristicProperties {
                    read: ch.properties.contains(CharPropFlags::READ),
                    write: ch.properties.contains(CharPropFlags::WRITE),
                    write_without_response: ch.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE),
                    notify: ch.properties.contains(CharPropFlags::NOTIFY),
                    indicate: ch.properties.contains(CharPropFlags::INDICATE),
                },
            });
        }
        result.push(BleService {
            uuid: service.uuid.to_string(),
            characteristics: chars,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn ble_detect_nus(state: State<'_, AppState>) -> Result<Option<NusAutoConfig>, String> {
    let ble = state.ble_state.clone();
    let peripheral = {
        let guard = ble.connected.lock().await;
        guard.clone().ok_or_else(|| "未连接 BLE 设备".to_string())?
    };

    let services = peripheral.services();
    for s in services {
        if s.uuid != NUS_SERVICE_UUID {
            continue;
        }
        let mut notify_uuid: Option<String> = None;
        let mut write_uuid: Option<String> = None;
        for c in &s.characteristics {
            if c.uuid == NUS_TX_CHAR_UUID
                && (c.properties.contains(CharPropFlags::NOTIFY) || c.properties.contains(CharPropFlags::INDICATE))
            {
                notify_uuid = Some(c.uuid.to_string());
            }
            if c.uuid == NUS_RX_CHAR_UUID
                && (c.properties.contains(CharPropFlags::WRITE)
                    || c.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE))
            {
                write_uuid = Some(c.uuid.to_string());
            }
        }
        if let (Some(n), Some(w)) = (notify_uuid, write_uuid) {
            return Ok(Some(NusAutoConfig {
                service_uuid: s.uuid.to_string(),
                notify_char_uuid: n,
                write_char_uuid: w,
            }));
        }
    }
    Ok(None)
}

// ============================================================================
// 订阅 / 取消订阅
// ============================================================================

async fn stop_notify(ble: &crate::ble::SharedBleState) {
    ble.set_notify_running(false);
    if let Some(handle) = ble.notify_task.lock().take() {
        handle.abort();
    }

    // 尝试在底层取消订阅，失败也忽略（设备可能已断开）
    let subscribed = ble.subscribed_char.lock().take();
    if let Some(uuid) = subscribed {
        let guard = ble.connected.lock().await;
        if let Some(p) = guard.as_ref() {
            if let Some(c) = p.characteristics().into_iter().find(|c| c.uuid == uuid) {
                let _ = p.unsubscribe(&c).await;
            }
        }
    }
}

#[tauri::command]
pub async fn ble_subscribe(char_uuid: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let ble = state.ble_state.clone();
    let target_uuid = Uuid::parse_str(&char_uuid).map_err(|e| format!("无效 UUID: {}", e))?;

    stop_notify(&ble).await;

    let peripheral = {
        let guard = ble.connected.lock().await;
        guard.clone().ok_or_else(|| "未连接 BLE 设备".to_string())?
    };

    let characteristic = peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == target_uuid)
        .ok_or_else(|| format!("找不到特征值: {}", char_uuid))?;

    if !characteristic.properties.contains(CharPropFlags::NOTIFY)
        && !characteristic.properties.contains(CharPropFlags::INDICATE)
    {
        return Err("特征值不支持 notify/indicate".into());
    }

    let mut notifications = peripheral
        .notifications()
        .await
        .map_err(|e| format!("获取通知流失败: {}", e))?;

    peripheral
        .subscribe(&characteristic)
        .await
        .map_err(|e| format!("订阅失败: {}", e))?;

    *ble.subscribed_char.lock() = Some(target_uuid);
    ble.set_notify_running(true);

    let _ = app.emit(
        "ble-status",
        BleStatusEvent {
            connected: true,
            running: true,
            error: None,
        },
    );

    let ble_clone = ble.clone();
    let app_clone = app.clone();
    let notify_peripheral = peripheral.clone();

    let handle = tokio::spawn(async move {
        const BATCH_SIZE_THRESHOLD: usize = 4096;
        const BATCH_TIMEOUT_MS: u64 = 10;

        let mut batch: Vec<BleDataChunk> = Vec::new();
        let mut batch_bytes = 0usize;
        let mut last_emit = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(BATCH_TIMEOUT_MS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                notif = notifications.next() => {
                    match notif {
                        Some(n) => {
                            if n.uuid == target_uuid {
                                let len = n.value.len();
                                ble_clone.add_rx(len as u64);
                                batch_bytes += len;
                                batch.push(BleDataChunk {
                                    data: n.value,
                                    timestamp: chrono::Utc::now().timestamp_millis(),
                                });
                                if batch_bytes >= BATCH_SIZE_THRESHOLD {
                                    let chunks = std::mem::take(&mut batch);
                                    batch_bytes = 0;
                                    let _ = app_clone.emit("ble-data", BleDataEvent {
                                        chunks,
                                        direction: "rx".into(),
                                    });
                                    last_emit = Instant::now();
                                }
                            }
                        }
                        None => break,
                    }
                }
                _ = tick.tick() => {
                    if !ble_clone.is_notify_running() { break; }
                    if !batch.is_empty() && last_emit.elapsed().as_millis() as u64 >= BATCH_TIMEOUT_MS {
                        let chunks = std::mem::take(&mut batch);
                        batch_bytes = 0;
                        let _ = app_clone.emit("ble-data", BleDataEvent {
                            chunks,
                            direction: "rx".into(),
                        });
                        last_emit = Instant::now();
                    }
                }
            }
        }

        if !batch.is_empty() {
            let _ = app_clone.emit(
                "ble-data",
                BleDataEvent {
                    chunks: batch,
                    direction: "rx".into(),
                },
            );
        }

        ble_clone.set_notify_running(false);
        // 通知流结束可能是设备掉线：以底层真实连接状态为准，而不是缓存的连接信息
        let connected = notify_peripheral.is_connected().await.unwrap_or(false);
        let _ = app_clone.emit(
            "ble-status",
            BleStatusEvent {
                connected,
                running: false,
                error: (!connected).then(|| "BLE 设备连接已断开".to_string()),
            },
        );
    });

    *ble.notify_task.lock() = Some(handle);

    Ok(())
}

#[tauri::command]
pub async fn ble_unsubscribe(state: State<'_, AppState>) -> Result<(), String> {
    stop_notify(&state.ble_state.clone()).await;
    Ok(())
}

// ============================================================================
// 写入
// ============================================================================

fn pick_write_type(char_props: CharPropFlags, with_response: Option<bool>) -> Result<WriteType, String> {
    match with_response {
        Some(true) => Ok(WriteType::WithResponse),
        Some(false) => Ok(WriteType::WithoutResponse),
        None => {
            if char_props.contains(CharPropFlags::WRITE) {
                Ok(WriteType::WithResponse)
            } else if char_props.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
                Ok(WriteType::WithoutResponse)
            } else {
                Err("特征值不可写".into())
            }
        }
    }
}

#[tauri::command]
pub async fn ble_write(
    char_uuid: String,
    data: Vec<u8>,
    with_response: Option<bool>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let ble = state.ble_state.clone();
    let target_uuid = Uuid::parse_str(&char_uuid).map_err(|e| format!("无效 UUID: {}", e))?;

    let peripheral = {
        let guard = ble.connected.lock().await;
        guard.clone().ok_or_else(|| "未连接 BLE 设备".to_string())?
    };

    let characteristic = peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == target_uuid)
        .ok_or_else(|| format!("找不到特征值: {}", char_uuid))?;

    let write_type = pick_write_type(characteristic.properties, with_response)?;
    let len = data.len();
    peripheral
        .write(&characteristic, &data, write_type)
        .await
        .map_err(|e| format!("写入失败: {}", e))?;

    ble.add_tx(len as u64);

    Ok(len)
}

#[tauri::command]
pub async fn ble_write_string(
    char_uuid: String,
    text: String,
    encoding: String,
    line_ending: String,
    with_response: Option<bool>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    // 与串口共用编码逻辑（含 GBK）
    let data = crate::commands::serial::encode_serial_text(text, &encoding, &line_ending);
    ble_write(char_uuid, data, with_response, state).await
}

#[cfg(test)]
mod tests {
    use super::pick_write_type;
    use btleplug::api::{CharPropFlags, WriteType};

    #[test]
    fn explicit_write_type_wins() {
        assert_eq!(
            pick_write_type(CharPropFlags::empty(), Some(true)).unwrap(),
            WriteType::WithResponse
        );
        assert_eq!(
            pick_write_type(CharPropFlags::WRITE, Some(false)).unwrap(),
            WriteType::WithoutResponse
        );
    }

    #[test]
    fn infers_write_type_from_properties() {
        let both = CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE;
        assert_eq!(pick_write_type(both, None).unwrap(), WriteType::WithResponse);
        assert_eq!(
            pick_write_type(CharPropFlags::WRITE_WITHOUT_RESPONSE, None).unwrap(),
            WriteType::WithoutResponse
        );
        assert!(pick_write_type(CharPropFlags::READ, None).is_err());
    }
}
