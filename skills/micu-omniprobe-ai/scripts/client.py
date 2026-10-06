#!/usr/bin/env python3
import argparse
from collections import deque
import json
import math
import select
import socket
import statistics
import sys
import time
import uuid

HOST = "127.0.0.1"
MAX_SNAPSHOT_TEXT_LINES = 200
SOURCES = ("serial", "rtt", "ble")
WRITE_TYPES = {"serial": "serial.write", "rtt": "rtt.write", "ble": "ble.write"}


def connect(port):
    sock = socket.create_connection((HOST, port), timeout=3)
    stream = sock.makefile("rwb", buffering=0)
    hello = json.loads(stream.readline())
    if hello.get("schema") != "ek.telemetry/v1" or hello.get("type") != "hello":
        raise RuntimeError("服务端未返回 ek.telemetry/v1 握手")
    return sock, stream, hello


def read_messages(sock, stream, seconds, source=None):
    deadline = math.inf if seconds <= 0 else time.monotonic() + seconds
    while time.monotonic() < deadline:
        timeout = 0.5 if deadline == math.inf else min(0.5, max(0, deadline - time.monotonic()))
        if not select.select([sock], [], [], timeout)[0]:
            continue
        line = stream.readline()
        if not line:
            break
        message = json.loads(line)
        if source and message.get("type") in ("samples", "text") and message.get("source") != source:
            continue
        yield message


def summarize(messages, duration, source=None):
    values = {}
    units = {}
    sample_rate = 0
    sample_count = 0
    text_line_count = 0
    text_lines = deque(maxlen=MAX_SNAPSHOT_TEXT_LINES)
    sources = set()
    for message in messages:
        if message.get("type") in ("samples", "text") and message.get("source"):
            sources.add(message["source"])
        if message.get("type") == "text":
            for line in message.get("lines", []):
                text_line_count += 1
                text_lines.append(line)
            continue
        if message.get("type") != "samples":
            continue
        sample_rate = message.get("sampleRateHz") or sample_rate
        units.update({item["key"]: item.get("unit") for item in message.get("channels", [])})
        for sample in message.get("samples", []):
            sample_count += 1
            for key, value in sample.get("values", {}).items():
                values.setdefault(key, []).append(value)

    channels = {}
    for key, series in values.items():
        channels[key] = {
            "unit": units.get(key),
            "count": len(series),
            "min": min(series),
            "max": max(series),
            "mean": statistics.fmean(series),
            "stddev": statistics.pstdev(series),
            "last": series[-1],
        }
    return {
        "source": source or "all",
        "sources": sorted(sources),
        "durationSeconds": duration,
        "sampleCount": sample_count,
        "sampleRateHz": sample_rate,
        "channels": channels,
        "textLineCount": text_line_count,
        "textLines": list(text_lines),
    }


def watch(args):
    sock, stream, hello = connect(args.port)
    sock.settimeout(None)
    print(json.dumps(hello, ensure_ascii=False), flush=True)
    try:
        for message in read_messages(sock, stream, args.seconds, args.source):
            print(json.dumps(message, ensure_ascii=False), flush=True)
    finally:
        stream.close()
        sock.close()


def snapshot(args):
    sock, stream, _ = connect(args.port)
    sock.settimeout(None)
    try:
        result = summarize(read_messages(sock, stream, args.seconds, args.source), args.seconds, args.source)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["sampleCount"] or result["textLineCount"] else 2
    finally:
        stream.close()
        sock.close()


def build_write_command(source, command_id, text, line_ending, channel=0):
    command = {
        "type": WRITE_TYPES[source],
        "id": command_id,
        "text": text,
        "lineEnding": line_ending,
    }
    if source == "rtt":
        command["channel"] = channel
    return command


def write(args):
    sock, stream, hello = connect(args.port)
    command_id = args.id or str(uuid.uuid4())
    command = build_write_command(args.source, command_id, args.text, args.line_ending, args.channel)
    stream.write(json.dumps(command, ensure_ascii=False).encode() + b"\n")
    stream.flush()
    try:
        while True:
            response = json.loads(stream.readline())
            if response.get("type") == "ack" and response.get("id") == command_id:
                print(json.dumps(response, ensure_ascii=False, indent=2))
                return 0 if response.get("ok") else 1
    finally:
        stream.close()
        sock.close()


def self_test(_args):
    result = summarize(
        [
            {"type": "samples", "source": "rtt", "sampleRateHz": 10, "samples": [{"values": {"x": 1}}, {"values": {"x": 3}}]},
            {
                "type": "text",
                "source": "rtt",
                "lines": [
                    {
                        "timestamp": 1234,
                        "direction": "rx",
                        "text": "measurement_state=no_signal",
                        "truncated": False,
                        "channel": 0,
                    }
                ],
            },
        ],
        1,
        "rtt",
    )
    assert result["source"] == "rtt"
    assert result["sources"] == ["rtt"]
    assert result["sampleCount"] == 2
    assert result["channels"]["x"]["mean"] == 2
    assert result["textLineCount"] == 1
    assert result["textLines"][0]["text"] == "measurement_state=no_signal"
    assert build_write_command("rtt", "a", "kp=1", "lf", 1) == {
        "type": "rtt.write",
        "id": "a",
        "text": "kp=1",
        "lineEnding": "lf",
        "channel": 1,
    }
    assert "channel" not in build_write_command("ble", "b", "kp=1", "lf")
    print("ok")


def add_source_argument(parser, required=False, help_text="只保留指定来源的数据；省略时接收全部来源"):
    parser.add_argument("--source", choices=SOURCES, required=required, help=help_text)


def main():
    parser = argparse.ArgumentParser(description="MICU-OmniProbe AI 数据桥接客户端")
    subparsers = parser.add_subparsers(dest="command", required=True)

    watch_parser = subparsers.add_parser("watch", help="持续输出 NDJSON 数据流")
    watch_parser.add_argument("--port", type=int, default=8765)
    watch_parser.add_argument("--seconds", type=float, default=0, help="0 表示持续运行")
    add_source_argument(watch_parser)
    watch_parser.set_defaults(func=watch)

    snapshot_parser = subparsers.add_parser("snapshot", help="采集时间窗并输出统计摘要")
    snapshot_parser.add_argument("--port", type=int, default=8765)
    snapshot_parser.add_argument("--seconds", type=float, default=5)
    add_source_argument(snapshot_parser)
    snapshot_parser.set_defaults(func=snapshot)

    write_parser = subparsers.add_parser("write", help="向串口、RTT 下行通道或蓝牙特征值发送一条受控文本命令")
    write_parser.add_argument("--port", type=int, default=8765)
    add_source_argument(write_parser, help_text="写入目标，默认 serial")
    write_parser.add_argument("--channel", type=int, default=0, help="RTT 下行通道号，仅 --source rtt 使用")
    write_parser.add_argument("--text", required=True)
    write_parser.add_argument("--line-ending", choices=("none", "lf", "crlf", "cr"), default="lf")
    write_parser.add_argument("--id")
    write_parser.set_defaults(func=write, source="serial")

    test_parser = subparsers.add_parser("self-test", help="运行离线自检")
    test_parser.set_defaults(func=self_test)

    try:
        args = parser.parse_args()
        result = args.func(args)
        return result or 0
    except (ConnectionError, OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"错误: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
