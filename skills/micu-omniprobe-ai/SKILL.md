---
name: micu-omniprobe-ai
description: 通过 MICU-OmniProbe 本机 TCP/NDJSON 桥接读取串口、RTT 或蓝牙（BLE）的文本与标准样本，分析日志和波形，并安全调节设备参数。用户要求观察串口/RTT/蓝牙数据、分析诊断输出、传感器或控制波形、评估调参效果、建议 PID 等参数、自动或半自动调参时使用。
---

# MICU-OmniProbe AI 调参

使用本 Skill 目录下的 `scripts/client.py`。只使用 Python 标准库。

## 准备

先确认用户使用哪个数据来源，记为 `<source>`：

- `serial`：串口工作台（经典蓝牙 SPP 也算串口）
- `rtt`：RTT 工作台
- `ble`：蓝牙工作台的 BLE 设备

要求用户在对应工作台中：

1. 连接设备并开始接收。
2. 如需分析波形，启用图表解析并确认字段正确；只分析文本时可跳过。
3. 打开“AI”并启动本机桥接；默认端口为 `8765`。三个工作台共用同一个桥接。

不要要求关闭图表；AI 文本与文本区来自同一批行，数值数据与图表来自同一批解析样本。

## 观察

先采集 5 秒摘要，始终带上 `--source`，避免不同设备的数据混在一起：

```bash
python <skill-dir>/scripts/client.py snapshot --port 8765 --source <source> --seconds 5
```

摘要的 `textLines` 包含最近 200 行文本。`direction` 表示 `rx` 或 `tx`；RTT 行带 `channel` 上行通道号；`truncated: true` 表示原始行过长，只提供了前 16384 个字符。`sources` 列出窗口内实际收到数据的来源；为空时提示用户确认工作台正在接收。即使 `sampleCount` 为 `0`，也应先检查 `textLineCount` 和 `textLines` 中的状态、错误与结论。

需要原始实时数据时：

```bash
python <skill-dir>/scripts/client.py watch --port 8765 --source <source> --seconds 10
```

`sampleRateHz` 为 `0` 表示设备未提供采样率。此时只根据样本顺序或宿主时间戳分析，不把批量到达间隔当作真实采样周期。

## 调参

1. 明确目标指标、参数当前值、合法范围、步长和恢复值；缺少任一安全信息时只给建议，不写设备。
2. 记录调参前摘要。一次只调整一个参数，并优先采用小步变化。
3. 展示拟发送的完整命令、目标来源、参数变化和风险，取得用户明确确认。
4. 提醒用户在对应工作台的“AI”面板显式开启该来源的写权限（各来源独立授权）。RTT 需要固件读取下行通道；BLE 写入用户在发送栏选中的可写特征值。
5. 执行：

```bash
python <skill-dir>/scripts/client.py write --port 8765 --source serial --text "kp=0.20" --line-ending lf
python <skill-dir>/scripts/client.py write --port 8765 --source rtt --channel 0 --text "kp=0.20" --line-ending lf
python <skill-dir>/scripts/client.py write --port 8765 --source ble --text "kp=0.20" --line-ending lf
```

6. 检查 ACK；重新采集相同来源、相同时长的摘要，对比目标指标。
7. 指标恶化、波形失稳、饱和或通信异常时立即停止继续调参，并建议恢复上一个安全值。

不得绕过界面写权限、参数边界或用户确认。不得并行修改多个相互耦合的参数。不得向用户未指定的来源写入。

## 协议

服务端逐行输出 `ek.telemetry/v1` JSON。握手 `hello` 的 `writeEnabled` 是对象，例如 `{"serial":false,"rtt":true,"ble":false}`。`samples` 消息包含 `seq`、`source`、`sampleRateHz`、`channels` 和 `samples`；`text` 消息包含 `seq`、`source` 和 `lines`，每行带 `timestamp`、`direction`、`text`、`truncated`，RTT 另带 `channel`。写命令格式：

```json
{"type":"serial.write","id":"唯一 ID","text":"kp=0.20","lineEnding":"lf"}
{"type":"rtt.write","id":"唯一 ID","text":"kp=0.20","lineEnding":"lf","channel":0}
{"type":"ble.write","id":"唯一 ID","text":"kp=0.20","lineEnding":"lf"}
```

允许的换行是 `none`、`lf`、`crlf`、`cr`，单条命令最多 1024 字节；`rtt.write` 的 `channel` 缺省为 `0`。服务端返回同一 `id` 的 `ack`。
