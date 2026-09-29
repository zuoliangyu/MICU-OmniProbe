use crate::serial::{
    file_transfer::{
        send_protocol_file, send_raw_file, simulate_file, FileTransferProtocol, SerialFileTransferOptions,
        SerialFileTransferProgress, SerialFileTransferResult,
    },
    list_serial_ports, LocalSerial, SerialConfig, SerialPortInfo, TcpSerial, UdpSerial,
};
use crate::state::{AppState, DataSource, SerialState};
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

/// Serial data event payload
#[derive(Clone, Serialize)]
struct SerialDataChunk {
    data: Vec<u8>,
    timestamp: i64,
}

#[derive(Clone, Serialize)]
struct SerialDataEvent {
    chunks: Vec<SerialDataChunk>,
    direction: String, // "rx" for received data
}

/// Serial status event payload
#[derive(Clone, Serialize)]
struct SerialStatusEvent {
    connected: bool,
    running: bool,
    error: Option<String>,
}

/// List available serial ports
#[tauri::command]
pub fn list_serial_ports_cmd() -> Result<Vec<SerialPortInfo>, String> {
    list_serial_ports()
}

/// Connect to a serial port
///
/// TCP 连接最长要等 5 秒，放到阻塞线程里做，避免同步命令卡住主线程/UI。
#[tauri::command]
pub async fn connect_serial(config: SerialConfig, state: State<'_, AppState>) -> Result<(), String> {
    let serial_state = Arc::clone(&state.serial_state);
    run_blocking(move || {
        // Stop any existing polling first
        serial_state.run.stop();
        serial_state.cancel_file_transfer();
        take_and_disconnect(&serial_state);

        // Create new data source based on config
        let mut datasource: Box<dyn DataSource> = match config {
            SerialConfig::Local {
                port,
                baud_rate,
                data_bits,
                stop_bits,
                parity,
                flow_control,
                dtr,
                rts,
                reconnect,
            } => Box::new(LocalSerial::new(
                port,
                baud_rate,
                data_bits,
                stop_bits,
                &parity,
                &flow_control,
                dtr,
                rts,
                reconnect,
            )),
            SerialConfig::Tcp { host, port, reconnect } => Box::new(TcpSerial::new(host, port, reconnect)),
            SerialConfig::Udp {
                local_host,
                local_port,
                remote_host,
                remote_port,
            } => Box::new(UdpSerial::new(local_host, local_port, remote_host, remote_port)),
        };

        // 在锁外建立连接，期间不挡住其他命令
        datasource.connect()?;
        *serial_state.datasource.lock() = Some(datasource);
        Ok(())
    })
    .await
}

/// Disconnect from serial port
#[tauri::command]
pub async fn disconnect_serial(state: State<'_, AppState>) -> Result<(), String> {
    let serial_state = Arc::clone(&state.serial_state);
    run_blocking(move || {
        // Stop polling first
        serial_state.run.stop();
        serial_state.cancel_file_transfer();
        match serial_state.datasource.lock().take() {
            Some(mut ds) => ds.disconnect(),
            None => Ok(()),
        }
    })
    .await
}

/// 取出当前数据源并断开；取出后立即释放锁，断开过程不占用锁
fn take_and_disconnect(serial_state: &SerialState) {
    let previous = serial_state.datasource.lock().take();
    if let Some(mut ds) = previous {
        let _ = ds.disconnect();
    }
}

async fn run_blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 普通串口写入；文件传输期间拒绝，避免协议帧与用户命令交错
async fn write_serial_bytes(serial_state: &Arc<SerialState>, data: Vec<u8>) -> Result<usize, String> {
    let serial_state = Arc::clone(serial_state);
    run_blocking(move || {
        if serial_state.is_file_transferring() {
            return Err("文件传输中，暂不能发送其他数据".to_string());
        }
        let mut guard = serial_state.datasource.lock();
        let ds = guard.as_mut().ok_or_else(|| "Serial port not connected".to_string())?;
        ds.write(&data)
    })
    .await
}

/// Write data to serial port
#[tauri::command]
pub async fn write_serial(data: Vec<u8>, state: State<'_, AppState>) -> Result<usize, String> {
    write_serial_bytes(&state.serial_state, data).await
}

/// Write string to serial port with optional encoding and line ending
pub(crate) fn encode_serial_text(text: String, encoding: &str, line_ending: &str) -> Vec<u8> {
    let text = match line_ending {
        "lf" => format!("{}\n", text),
        "crlf" => format!("{}\r\n", text),
        "cr" => format!("{}\r", text),
        _ => text,
    };
    crate::text_encoding::encode_text(&text, encoding)
}

#[cfg(test)]
mod text_encoding_tests {
    use super::encode_serial_text;

    #[test]
    fn encodes_gbk_text_and_line_ending() {
        assert_eq!(
            encode_serial_text("中文".to_string(), "gbk", "lf"),
            [0xd6, 0xd0, 0xce, 0xc4, 0x0a]
        );
    }
}

#[tauri::command]
pub async fn write_serial_string(
    text: String,
    encoding: String,
    line_ending: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    write_serial_bytes(&state.serial_state, encode_serial_text(text, &encoding, &line_ending)).await
}

struct FileTransferGuard(Arc<SerialState>);

impl Drop for FileTransferGuard {
    fn drop(&mut self) {
        self.0.finish_file_transfer();
    }
}

#[tauri::command]
pub async fn send_serial_file(
    options: SerialFileTransferOptions,
    on_progress: Channel<SerialFileTransferProgress>,
    state: State<'_, AppState>,
) -> Result<SerialFileTransferResult, String> {
    if !options.simulation && !state.serial_state.is_connected() {
        return Err("串口未连接".to_string());
    }
    if options.simulation && options.protocol != FileTransferProtocol::Raw {
        return Err("模拟数据源仅支持原始字节文件发送".to_string());
    }

    let serial_state = Arc::clone(&state.serial_state);
    serial_state.begin_file_transfer(options.protocol.is_exclusive())?;
    let transfer_guard = FileTransferGuard(Arc::clone(&serial_state));

    tokio::task::spawn_blocking(move || {
        let _transfer_guard = transfer_guard;
        let mut report = |progress| {
            let _ = on_progress.send(progress);
        };

        if options.simulation {
            return simulate_file(&options.path, &mut report);
        }
        if options.protocol == FileTransferProtocol::Raw {
            return send_raw_file(&serial_state, &options, &mut report);
        }

        let mut guard = serial_state.datasource.lock();
        let source = guard.as_mut().ok_or_else(|| "串口未连接".to_string())?;
        if source.name().starts_with("udp://") {
            return Err("UDP 数据源仅支持原始字节文件发送".to_string());
        }
        send_protocol_file(source.as_mut(), &serial_state, &options, &mut report)
    })
    .await
    .map_err(|error| format!("文件传输任务异常: {error}"))?
}

#[tauri::command]
pub fn cancel_serial_file_transfer(state: State<'_, AppState>) -> bool {
    state.serial_state.cancel_file_transfer()
}

/// Start serial polling
///
/// 架构：专用阻塞读线程 + tokio mpsc + async 批处理。
/// - 读线程独占一个 OS 线程，常驻在 `read()` 上，最大程度压低 OS 驱动 RX FIFO 占用，避免高 baud 时丢字节。
/// - async 侧只做 batching/emit，不再用 polling timer。
#[tauri::command]
pub async fn start_serial(
    poll_interval: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.serial_state.is_running() {
        return Ok(());
    }

    if !state.serial_state.is_connected() {
        return Err("Serial port not connected".to_string());
    }

    // 兼容字段：前端可能仍传 poll_interval，但读线程常驻 read()，不再使用轮询间隔。
    let _ = poll_interval;
    let serial_state = Arc::clone(&state.serial_state);
    let generation = serial_state.run.start();

    // mpsc 通道：reader -> async accumulator。无界，让读线程永远不会被反压阻塞。
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<SerialDataChunk>();

    // ===== 读线程：独立 OS 线程，循环 read() 并把每段 chunk 发到 channel =====
    let reader_state = Arc::clone(&serial_state);
    let reader_app = app.clone();
    std::thread::Builder::new()
        .name("serial-reader".into())
        .spawn(move || {
            let mut local_buf = vec![0u8; 16384];

            'outer: loop {
                // 代次变化说明已被停止或被新一轮启动取代，旧线程必须退出
                if !reader_state.run.is_current(generation) {
                    break;
                }

                if reader_state.is_file_transfer_exclusive() {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }

                // 进入临界区只为这一次 read，结束就解锁，避免长时间挡 write/disconnect。
                let result = {
                    let mut guard = reader_state.datasource.lock();
                    match guard.as_mut() {
                        Some(ds) => ds.read(&mut local_buf),
                        None => break,
                    }
                };

                match result {
                    Ok(0) => {
                        // 50ms timeout 触发，没有数据，立刻再 read。
                        continue;
                    }
                    Ok(n) => {
                        let chunk = SerialDataChunk {
                            data: local_buf[..n].to_vec(),
                            timestamp: chrono::Utc::now().timestamp_millis(),
                        };
                        if tx.send(chunk).is_err() {
                            // accumulator 已退出，没人收了。
                            break;
                        }
                    }
                    Err(e) => {
                        let wants_reconnect = {
                            let guard = reader_state.datasource.lock();
                            guard.as_ref().map(|d| d.wants_reconnect()).unwrap_or(false)
                        };

                        if !wants_reconnect {
                            // 读失败后旧句柄已经不可用，必须先释放；否则 is_connected()
                            // 仍会因为 port 为 Some 而把断线状态覆盖成“已连接”。
                            {
                                let mut guard = reader_state.datasource.lock();
                                if let Some(ds) = guard.as_mut() {
                                    let _ = ds.disconnect();
                                }
                            }
                            if reader_state.run.finish(generation) {
                                let _ = reader_app.emit(
                                    "serial-status",
                                    SerialStatusEvent {
                                        connected: false,
                                        running: false,
                                        error: Some(e),
                                    },
                                );
                            }
                            break;
                        }

                        let _ = reader_app.emit(
                            "serial-status",
                            SerialStatusEvent {
                                connected: false,
                                running: true,
                                error: Some(format!("连接断开，正在尝试重连: {}", e)),
                            },
                        );

                        // 指数退避重连。重连期间把数据源取出锁外处理，
                        // TCP 连接最长 5 秒，不能一直占着锁挡住 disconnect/write。
                        let mut delay_ms: u64 = 1000;
                        loop {
                            std::thread::sleep(Duration::from_millis(delay_ms));
                            if !reader_state.run.is_current(generation) {
                                break 'outer;
                            }

                            let Some(mut ds) = reader_state.datasource.lock().take() else {
                                break 'outer;
                            };
                            let _ = ds.disconnect();
                            let connect_result = ds.connect();

                            // 放回前再确认：期间用户可能已断开或重新连接了别的端口
                            {
                                let mut guard = reader_state.datasource.lock();
                                if !reader_state.run.is_current(generation) || guard.is_some() {
                                    drop(guard);
                                    let _ = ds.disconnect();
                                    break 'outer;
                                }
                                *guard = Some(ds);
                            }

                            match connect_result {
                                Ok(_) => {
                                    let _ = reader_app.emit(
                                        "serial-status",
                                        SerialStatusEvent {
                                            connected: true,
                                            running: true,
                                            error: None,
                                        },
                                    );
                                    break;
                                }
                                Err(_) => {
                                    delay_ms = delay_ms.saturating_mul(2).min(5000);
                                }
                            }
                        }
                    }
                }
            }
            // tx drop -> accumulator 收到 None 退出
        })
        .map_err(|e| format!("Failed to spawn reader thread: {}", e))?;

    // ===== async accumulator：batch + emit =====
    let accumulator_state = Arc::clone(&serial_state);
    tokio::spawn(async move {
        const BATCH_TIMEOUT_MS: u64 = 10;
        const BATCH_SIZE_THRESHOLD: usize = 4096;

        let mut batch_chunks: Vec<SerialDataChunk> = Vec::new();
        let mut batch_bytes = 0usize;
        let mut last_emit = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(BATCH_TIMEOUT_MS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Some(chunk) => {
                            batch_bytes += chunk.data.len();
                            batch_chunks.push(chunk);
                            if batch_bytes >= BATCH_SIZE_THRESHOLD {
                                let chunks = std::mem::take(&mut batch_chunks);
                                batch_bytes = 0;
                                let _ = app.emit(
                                    "serial-data",
                                    SerialDataEvent {
                                        chunks,
                                        direction: "rx".to_string(),
                                    },
                                );
                                last_emit = Instant::now();
                            }
                        }
                        None => break, // reader thread 退出 -> channel 关闭
                    }
                }
                _ = tick.tick() => {
                    if !batch_chunks.is_empty()
                        && last_emit.elapsed().as_millis() as u64 >= BATCH_TIMEOUT_MS
                    {
                        let chunks = std::mem::take(&mut batch_chunks);
                        batch_bytes = 0;
                        let _ = app.emit(
                            "serial-data",
                            SerialDataEvent {
                                chunks,
                                direction: "rx".to_string(),
                            },
                        );
                        last_emit = Instant::now();
                    }
                }
            }
        }

        // flush 残留
        if !batch_chunks.is_empty() {
            let _ = app.emit(
                "serial-data",
                SerialDataEvent {
                    chunks: batch_chunks,
                    direction: "rx".to_string(),
                },
            );
        }

        // 正常停止时同步 running=false；读失败已经由 reader 上报，不能再用
        // 无错误的结束事件覆盖断线原因；已被新一轮启动取代时也不能发。
        if !accumulator_state.is_running() && accumulator_state.is_connected() {
            let _ = app.emit(
                "serial-status",
                SerialStatusEvent {
                    connected: true,
                    running: false,
                    error: None,
                },
            );
        }
    });

    Ok(())
}

/// Stop serial polling
#[tauri::command]
pub fn stop_serial(state: State<'_, AppState>) -> Result<(), String> {
    state.serial_state.run.stop();
    Ok(())
}

/// Clear serial buffer
#[tauri::command]
pub fn clear_serial_buffer(state: State<'_, AppState>) -> Result<(), String> {
    // 行缓冲在前端维护，后端只需重置统计
    if let Some(ds) = state.serial_state.datasource.lock().as_mut() {
        ds.reset_stats();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_event_preserves_each_chunk_timestamp() {
        let event = SerialDataEvent {
            chunks: vec![
                SerialDataChunk {
                    data: vec![b'a', b'\n'],
                    timestamp: 1_000,
                },
                SerialDataChunk {
                    data: vec![b'b', b'\n'],
                    timestamp: 1_005,
                },
            ],
            direction: "rx".to_string(),
        };

        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["chunks"][0]["timestamp"], 1_000);
        assert_eq!(value["chunks"][1]["timestamp"], 1_005);
    }
}
