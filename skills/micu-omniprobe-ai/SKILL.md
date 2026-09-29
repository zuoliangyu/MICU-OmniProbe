---
name: micu-omniprobe-ai
description: 通过 MICU-OmniProbe 本机 TCP/NDJSON 桥接读取串口文本与标准样本、分析日志和波形，并安全调节设备参数。用户要求观察串口数据、分析诊断输出、传感器或控制波形、评估调参效果、建议 PID 等参数、自动或半自动调参时使用。
---

# MICU-OmniProbe AI 调参

使用本 Skill 目录下的 `scripts/client.py`。只使用 Python 标准库。

## 准备

要求用户在 MICU-OmniProbe 串口工作台中：

1. 连接设备并开始接收。
2. 如需分析波形，启用图表解析并确认字段正确；只分析文本时可跳过。
3. 打开“AI”并启动本机桥接；默认端口为 `8765`。

不要要求关闭图表；AI 文本与文本区来自同一批串口行，数值数据与图表来自同一批解析样本。

## 观察

先采集 5 秒摘要：

```bash
python <skill-dir>/scripts/client.py snapshot --port 8765 --seconds 5
```

摘要的 `textLines` 包含最近 200 行串口文本。`direction` 表示 `rx` 或 `tx`；`truncated: true` 表示原始行过长，只提供了前 16384 个字符。即使 `sampleCount` 为 `0`，也应先检查 `textLineCount` 和 `textLines` 中的状态、错误与结论。

需要原始实时数据时：

```bash
python <skill-dir>/scripts/client.py watch --port 8765 --seconds 10
```

`sampleRateHz` 为 `0` 表示设备未提供采样率。此时只根据样本顺序或宿主时间戳分析，不把串口批量到达间隔当作真实采样周期。

## 调参

1. 明确目标指标、参数当前值、合法范围、步长和恢复值；缺少任一安全信息时只给建议，不写设备。
2. 记录调参前摘要。一次只调整一个参数，并优先采用小步变化。
3. 展示拟发送的完整命令、参数变化和风险，取得用户明确确认。
4. 提醒用户在界面显式开启“允许 AI 写串口”。
5. 执行：

```bash
python <skill-dir>/scripts/client.py write --port 8765 --text "kp=0.20" --line-ending lf
```

6. 检查 ACK；重新采集相同时长摘要，对比目标指标。
7. 指标恶化、波形失稳、饱和或通信异常时立即停止继续调参，并建议恢复上一个安全值。

不得绕过界面写权限、参数边界或用户确认。不得并行修改多个相互耦合的参数。

## 协议

服务端逐行输出 `ek.telemetry/v1` JSON。`samples` 消息包含 `seq`、`source`、`sampleRateHz`、`channels` 和 `samples`；`text` 消息包含 `seq`、`source` 和 `lines`，每行带 `timestamp`、`direction`、`text`、`truncated`。写命令格式：

```json
{"type":"serial.write","id":"唯一 ID","text":"kp=0.20","lineEnding":"lf"}
```

允许的换行是 `none`、`lf`、`crlf`、`cr`，单条串口命令最多 1024 字节。服务端返回同一 `id` 的 `ack`。
