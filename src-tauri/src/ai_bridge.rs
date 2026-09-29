use crate::state::{AppState, SerialState};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::State;

const SCHEMA: &str = "ek.telemetry/v1";
const MAX_COMMAND_BYTES: usize = 1024;
const MAX_CLIENT_LINE_BYTES: usize = 8192;
const MAX_TEXT_LINES_PER_BATCH: usize = 256;
const MAX_TEXT_LINE_BYTES: usize = 64 * 1024;
const MAX_TEXT_BATCH_BYTES: usize = 256 * 1024;
const CLIENT_QUEUE_CAPACITY: usize = 32;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTelemetryChannel {
    pub key: String,
    pub name: String,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AiTelemetrySample {
    pub timestamp: i64,
    pub values: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTelemetryBatch {
    pub source: String,
    pub sample_rate_hz: f64,
    pub channels: Vec<AiTelemetryChannel>,
    pub samples: Vec<AiTelemetrySample>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AiTextDirection {
    Rx,
    Tx,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTextLine {
    pub timestamp: i64,
    pub direction: AiTextDirection,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTextBatch {
    pub source: String,
    pub lines: Vec<AiTextLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBridgeStatus {
    pub running: bool,
    pub port: u16,
    pub allow_write: bool,
    pub clients: usize,
    pub dropped_batches: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryEnvelope<'a> {
    schema: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
    seq: u64,
    #[serde(flatten)]
    batch: &'a AiTelemetryBatch,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextEnvelope<'a> {
    schema: &'static str,
    #[serde(rename = "type")]
    kind: &'static str,
    seq: u64,
    #[serde(flatten)]
    batch: &'a AiTextBatch,
}

struct BridgeClient {
    id: u64,
    tx: SyncSender<String>,
    stream: TcpStream,
}

pub struct AiBridgeState {
    running: AtomicBool,
    allow_write: AtomicBool,
    port: AtomicU16,
    next_client_id: AtomicU64,
    next_sequence: AtomicU64,
    dropped_batches: AtomicU64,
    clients: Mutex<Vec<BridgeClient>>,
    listener_thread: Mutex<Option<JoinHandle<()>>>,
}

impl Default for AiBridgeState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            allow_write: AtomicBool::new(false),
            port: AtomicU16::new(0),
            next_client_id: AtomicU64::new(1),
            next_sequence: AtomicU64::new(1),
            dropped_batches: AtomicU64::new(0),
            clients: Mutex::new(Vec::new()),
            listener_thread: Mutex::new(None),
        }
    }
}

impl AiBridgeState {
    pub fn start(
        self: &Arc<Self>,
        port: u16,
        allow_write: bool,
        serial_state: Arc<SerialState>,
    ) -> Result<AiBridgeStatus, String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("AI 数据桥接已启动".to_string());
        }

        let listener =
            TcpListener::bind(("127.0.0.1", port)).map_err(|error| format!("无法监听 127.0.0.1:{port}: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("无法配置 AI 数据桥接: {error}"))?;
        let actual_port = listener
            .local_addr()
            .map_err(|error| format!("无法读取 AI 数据桥接端口: {error}"))?
            .port();

        self.allow_write.store(allow_write, Ordering::SeqCst);
        self.port.store(actual_port, Ordering::SeqCst);
        self.dropped_batches.store(0, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);

        let bridge = Arc::clone(self);
        let handle = thread::Builder::new()
            .name("ai-bridge-listener".to_string())
            .spawn(move || {
                while bridge.running.load(Ordering::SeqCst) {
                    match listener.accept() {
                        Ok((stream, _)) => bridge.attach_client(stream, Arc::clone(&serial_state)),
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(25));
                        }
                        Err(error) => {
                            log::error!("AI 数据桥接监听失败: {error}");
                            bridge.running.store(false, Ordering::SeqCst);
                            break;
                        }
                    }
                }
            })
            .map_err(|error| {
                self.running.store(false, Ordering::SeqCst);
                self.port.store(0, Ordering::SeqCst);
                format!("无法启动 AI 数据桥接线程: {error}")
            })?;
        *self.listener_thread.lock() = Some(handle);

        Ok(self.status())
    }

    pub fn stop(&self) -> AiBridgeStatus {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.listener_thread.lock().take() {
            let _ = handle.join();
        }

        let mut clients = self.clients.lock();
        for client in clients.iter() {
            let _ = client.stream.shutdown(Shutdown::Both);
        }
        clients.clear();
        self.port.store(0, Ordering::SeqCst);
        self.allow_write.store(false, Ordering::SeqCst);
        drop(clients);
        self.status()
    }

    pub fn set_allow_write(&self, allow_write: bool) -> AiBridgeStatus {
        self.allow_write.store(allow_write, Ordering::SeqCst);
        self.status()
    }

    pub fn status(&self) -> AiBridgeStatus {
        AiBridgeStatus {
            running: self.running.load(Ordering::SeqCst),
            port: self.port.load(Ordering::SeqCst),
            allow_write: self.allow_write.load(Ordering::SeqCst),
            clients: self.clients.lock().len(),
            dropped_batches: self.dropped_batches.load(Ordering::SeqCst),
        }
    }

    pub fn publish(&self, batch: AiTelemetryBatch) -> Result<(), String> {
        validate_batch(&batch)?;
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let seq = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        let line = serde_json::to_string(&TelemetryEnvelope {
            schema: SCHEMA,
            kind: "samples",
            seq,
            batch: &batch,
        })
        .map_err(|error| format!("无法编码 AI 样本: {error}"))?;

        self.broadcast(line);
        Ok(())
    }

    pub fn publish_text(&self, batch: AiTextBatch) -> Result<(), String> {
        validate_text_batch(&batch)?;
        if !self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let seq = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        let line = serde_json::to_string(&TextEnvelope {
            schema: SCHEMA,
            kind: "text",
            seq,
            batch: &batch,
        })
        .map_err(|error| format!("无法编码 AI 文本: {error}"))?;

        self.broadcast(line);
        Ok(())
    }

    fn broadcast(&self, line: String) {
        let mut dropped = 0u64;
        self.clients
            .lock()
            .retain(|client| match client.tx.try_send(line.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) => {
                    dropped += 1;
                    true
                }
                Err(TrySendError::Disconnected(_)) => false,
            });
        if dropped > 0 {
            self.dropped_batches.fetch_add(dropped, Ordering::Relaxed);
        }
    }

    fn attach_client(self: &Arc<Self>, stream: TcpStream, serial_state: Arc<SerialState>) {
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
        let writer_stream = match stream.try_clone() {
            Ok(stream) => stream,
            Err(error) => {
                log::warn!("AI 客户端连接初始化失败: {error}");
                return;
            }
        };
        let status_stream = match stream.try_clone() {
            Ok(stream) => stream,
            Err(error) => {
                log::warn!("AI 客户端连接初始化失败: {error}");
                return;
            }
        };
        let _ = writer_stream.set_write_timeout(Some(Duration::from_millis(200)));

        let id = self.next_client_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::sync_channel::<String>(CLIENT_QUEUE_CAPACITY);
        let hello = json!({
            "schema": SCHEMA,
            "type": "hello",
            "writeEnabled": self.allow_write.load(Ordering::SeqCst),
            "maxCommandBytes": MAX_COMMAND_BYTES,
        })
        .to_string();
        let _ = tx.try_send(hello);
        self.clients.lock().push(BridgeClient {
            id,
            tx: tx.clone(),
            stream: status_stream,
        });

        thread::spawn(move || {
            let mut writer = writer_stream;
            while let Ok(line) = rx.recv() {
                if writer.write_all(line.as_bytes()).is_err() || writer.write_all(b"\n").is_err() {
                    break;
                }
            }
            let _ = writer.shutdown(Shutdown::Both);
        });

        let bridge = Arc::clone(self);
        thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line_buffer = Vec::with_capacity(256);
            while bridge.running.load(Ordering::SeqCst) {
                match read_line_limited(&mut reader, &mut line_buffer) {
                    Ok(Some(line)) if !is_json_object_line(&line) => {
                        // 浏览器可以用 no-cors 请求把 HTTP 报文打到本端口，body 里夹带合法命令；
                        // 协议只接受逐行 JSON 对象，遇到其他内容（例如 HTTP 请求行）直接断开。
                        let _ = tx.send(error_response(
                            None,
                            "协议要求每行一个 JSON 对象，连接已关闭".to_string(),
                        ));
                        break;
                    }
                    Ok(Some(line)) => {
                        let response = bridge.handle_client_line(&line, &serial_state);
                        if tx.send(response).is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error)
                        if error.kind() == io::ErrorKind::WouldBlock || error.kind() == io::ErrorKind::TimedOut => {}
                    Err(error) => {
                        let _ = tx.send(error_response(None, error.to_string()));
                        break;
                    }
                }
            }
            bridge.clients.lock().retain(|client| client.id != id);
        });
    }

    fn handle_client_line(&self, line: &str, serial_state: &SerialState) -> String {
        let id = serde_json::from_str::<serde_json::Value>(line)
            .ok()
            .and_then(|value| value.get("id")?.as_str().map(str::to_string));
        let command = match parse_client_command(line, self.allow_write.load(Ordering::SeqCst)) {
            Ok(command) => command,
            Err(error) => return error_response(id.as_deref(), error),
        };

        let ClientCommand::SerialWrite { id, data } = command;
        let result = if serial_state.is_file_transferring() {
            Err("文件传输中，暂不能发送 AI 串口命令".to_string())
        } else {
            serial_state
                .datasource
                .lock()
                .as_mut()
                .ok_or_else(|| "串口未连接".to_string())
                .and_then(|source| source.write(&data))
        };
        match result {
            Ok(written) => json!({
                "schema": SCHEMA,
                "type": "ack",
                "id": id,
                "ok": true,
                "written": written,
            })
            .to_string(),
            Err(error) => error_response(Some(&id), error),
        }
    }
}

fn validate_batch(batch: &AiTelemetryBatch) -> Result<(), String> {
    if batch.source != "serial" {
        return Err("AI 数据桥接当前仅支持 serial 数据源".to_string());
    }
    if !batch.sample_rate_hz.is_finite() || batch.sample_rate_hz < 0.0 {
        return Err("sampleRateHz 必须是非负有限数".to_string());
    }
    if batch.channels.len() > 64 || batch.samples.len() > 2048 {
        return Err("单批最多包含 64 个通道和 2048 个样本".to_string());
    }
    if batch
        .samples
        .iter()
        .any(|sample| sample.values.len() > 64 || sample.values.values().any(|value| !value.is_finite()))
    {
        return Err("样本必须包含不超过 64 个有限数值".to_string());
    }
    Ok(())
}

fn validate_text_batch(batch: &AiTextBatch) -> Result<(), String> {
    if batch.source != "serial" {
        return Err("AI 数据桥接当前仅支持 serial 数据源".to_string());
    }
    if batch.lines.len() > MAX_TEXT_LINES_PER_BATCH {
        return Err("单批最多包含 256 行文本".to_string());
    }
    if batch.lines.iter().any(|line| line.text.len() > MAX_TEXT_LINE_BYTES) {
        return Err("单行文本不能超过 65536 字节".to_string());
    }
    if batch.lines.iter().map(|line| line.text.len()).sum::<usize>() > MAX_TEXT_BATCH_BYTES {
        return Err("单批文本不能超过 262144 字节".to_string());
    }
    Ok(())
}

fn read_line_limited<R: BufRead>(reader: &mut R, bytes: &mut Vec<u8>) -> io::Result<Option<String>> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            break;
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index + 1);
        if bytes.len() + take > MAX_CLIENT_LINE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "AI 命令行不能超过 8192 字节",
            ));
        }
        bytes.extend_from_slice(&available[..take]);
        reader.consume(take);
        if newline.is_some() {
            break;
        }
    }

    let mut line = std::mem::take(bytes);
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    String::from_utf8(line)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "AI 命令必须使用 UTF-8"))
}

fn is_json_object_line(line: &str) -> bool {
    matches!(
        serde_json::from_str::<serde_json::Value>(line),
        Ok(serde_json::Value::Object(_))
    )
}

fn error_response(id: Option<&str>, error: String) -> String {
    json!({
        "schema": SCHEMA,
        "type": "ack",
        "id": id,
        "ok": false,
        "error": error,
    })
    .to_string()
}

#[tauri::command]
pub fn start_ai_bridge(port: u16, allow_write: bool, state: State<'_, AppState>) -> Result<AiBridgeStatus, String> {
    if port < 1024 {
        return Err("AI 数据桥接端口必须在 1024-65535 之间".to_string());
    }
    state
        .ai_bridge_state
        .start(port, allow_write, Arc::clone(&state.serial_state))
}

#[tauri::command]
pub fn stop_ai_bridge(state: State<'_, AppState>) -> AiBridgeStatus {
    state.ai_bridge_state.stop()
}

#[tauri::command]
pub fn get_ai_bridge_status(state: State<'_, AppState>) -> AiBridgeStatus {
    state.ai_bridge_state.status()
}

#[tauri::command]
pub fn set_ai_bridge_write_enabled(allow_write: bool, state: State<'_, AppState>) -> AiBridgeStatus {
    state.ai_bridge_state.set_allow_write(allow_write)
}

#[tauri::command]
pub fn publish_ai_samples(batch: AiTelemetryBatch, state: State<'_, AppState>) -> Result<(), String> {
    state.ai_bridge_state.publish(batch)
}

#[tauri::command]
pub fn publish_ai_text_lines(batch: AiTextBatch, state: State<'_, AppState>) -> Result<(), String> {
    state.ai_bridge_state.publish_text(batch)
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum RawClientCommand {
    #[serde(rename = "serial.write")]
    SerialWrite {
        id: String,
        text: String,
        #[serde(rename = "lineEnding", default)]
        line_ending: String,
    },
}

#[derive(Debug)]
enum ClientCommand {
    SerialWrite { id: String, data: Vec<u8> },
}

fn parse_client_command(line: &str, allow_write: bool) -> Result<ClientCommand, String> {
    let command: RawClientCommand = serde_json::from_str(line).map_err(|error| format!("无效 JSON 命令: {error}"))?;
    if !allow_write {
        return Err("AI 串口写入未授权".to_string());
    }

    let RawClientCommand::SerialWrite { id, text, line_ending } = command;
    if id.is_empty() || id.len() > 64 {
        return Err("命令 id 必须为 1-64 字节".to_string());
    }
    let suffix = match line_ending.as_str() {
        "" | "none" => "",
        "lf" => "\n",
        "crlf" => "\r\n",
        "cr" => "\r",
        _ => return Err("lineEnding 仅支持 none/lf/crlf/cr".to_string()),
    };

    let data = format!("{text}{suffix}").into_bytes();
    if data.len() > MAX_COMMAND_BYTES {
        return Err("串口命令不能超过 1024 字节".to_string());
    }

    Ok(ClientCommand::SerialWrite { id, data })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::SerialState;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::sync::Arc;

    #[test]
    fn only_json_object_lines_are_accepted() {
        assert!(is_json_object_line(r#"{"type":"serial.write"}"#));
        assert!(!is_json_object_line("POST / HTTP/1.1"));
        assert!(!is_json_object_line("Content-Type: text/plain"));
        assert!(!is_json_object_line("[1,2]"));
        assert!(!is_json_object_line(""));
    }

    #[test]
    fn serial_write_is_rejected_until_user_enables_it() {
        let result = parse_client_command(
            r#"{"type":"serial.write","id":"tune-1","text":"kp=0.2","lineEnding":"lf"}"#,
            false,
        );

        assert_eq!(result.unwrap_err(), "AI 串口写入未授权");
    }

    #[test]
    fn authorized_serial_write_applies_requested_line_ending() {
        let command = parse_client_command(
            r#"{"type":"serial.write","id":"tune-2","text":"ki=0.05","lineEnding":"crlf"}"#,
            true,
        )
        .unwrap();

        let ClientCommand::SerialWrite { id, data } = command;
        assert_eq!(id, "tune-2");
        assert_eq!(data, b"ki=0.05\r\n");
    }

    #[test]
    fn oversized_serial_write_is_rejected() {
        let line = serde_json::json!({
            "type": "serial.write",
            "id": "too-large",
            "text": "x".repeat(1025),
            "lineEnding": "none"
        })
        .to_string();

        assert_eq!(
            parse_client_command(&line, true).unwrap_err(),
            "串口命令不能超过 1024 字节"
        );
    }

    #[test]
    fn http_request_closes_connection_before_body_runs() {
        let bridge = Arc::new(AiBridgeState::default());
        let status = bridge.start(0, true, Arc::new(SerialState::default())).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        stream
            .write_all(b"POST / HTTP/1.1\r\nHost: x\r\n\r\n{\"type\":\"serial.write\",\"id\":\"x\",\"text\":\"a\"}\n")
            .unwrap();
        let mut reader = BufReader::new(stream);

        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&line).unwrap()["type"],
            "hello"
        );
        line.clear();
        reader.read_line(&mut line).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&line).unwrap()["ok"], false);
        line.clear();
        assert_eq!(reader.read_line(&mut line).unwrap(), 0, "服务端应已关闭连接");
        bridge.stop();
    }

    #[test]
    fn client_receives_hello_and_normalized_samples() {
        let bridge = Arc::new(AiBridgeState::default());
        let status = bridge.start(0, false, Arc::new(SerialState::default())).unwrap();
        let stream = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(stream);

        let mut hello = String::new();
        reader.read_line(&mut hello).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&hello).unwrap()["type"],
            "hello"
        );

        bridge
            .publish(AiTelemetryBatch {
                source: "serial".to_string(),
                sample_rate_hz: 1000.0,
                channels: vec![AiTelemetryChannel {
                    key: "speed".to_string(),
                    name: "转速".to_string(),
                    unit: Some("rpm".to_string()),
                }],
                samples: vec![AiTelemetrySample {
                    timestamp: 1234,
                    values: [("speed".to_string(), 1200.0)].into(),
                }],
            })
            .unwrap();

        let mut samples = String::new();
        reader.read_line(&mut samples).unwrap();
        let samples: serde_json::Value = serde_json::from_str(&samples).unwrap();
        assert_eq!(samples["schema"], "ek.telemetry/v1");
        assert_eq!(samples["samples"][0]["values"]["speed"], 1200.0);

        bridge.stop();
    }

    #[test]
    fn client_receives_serial_text_lines() {
        let bridge = Arc::new(AiBridgeState::default());
        let status = bridge.start(0, false, Arc::new(SerialState::default())).unwrap();
        let stream = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(stream);

        let mut hello = String::new();
        reader.read_line(&mut hello).unwrap();

        bridge
            .publish_text(AiTextBatch {
                source: "serial".to_string(),
                lines: vec![AiTextLine {
                    timestamp: 1234,
                    direction: AiTextDirection::Rx,
                    text: "measurement_state=no_signal".to_string(),
                    truncated: false,
                }],
            })
            .unwrap();

        let mut text = String::new();
        reader.read_line(&mut text).unwrap();
        let text: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(text["schema"], "ek.telemetry/v1");
        assert_eq!(text["type"], "text");
        assert_eq!(text["lines"][0]["direction"], "rx");
        assert_eq!(text["lines"][0]["text"], "measurement_state=no_signal");
        assert_eq!(text["lines"][0]["truncated"], false);

        bridge.stop();
    }
}
