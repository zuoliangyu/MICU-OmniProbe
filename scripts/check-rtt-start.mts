// RTT 启动参数构建、十六进制地址解析与 base64 数据批次解码。
import assert from "node:assert/strict";
import { buildRttStartOptions, decodeRttChunks, formatHexAddress, parseHexAddress } from "../src/lib/rttStart.ts";

const base = {
  scanMode: "auto" as const,
  scanAddress: 0x20000000,
  rangeSize: 0x10000,
  elfPath: "",
  pollInterval: 10,
  haltOnRead: false,
  coreIndex: 0,
  recoverTimeoutMs: 10_000,
};

// 地址解析：支持 0x 前缀、大小写、下划线分隔；非法输入返回 null
assert.equal(parseHexAddress("0x20000400"), 0x20000400);
assert.equal(parseHexAddress("2000_0400"), 0x20000400);
assert.equal(parseHexAddress("  0XdeadBEEF "), 0xdeadbeef);
assert.equal(parseHexAddress(""), null);
assert.equal(parseHexAddress("0x"), null);
assert.equal(parseHexAddress("12g4"), null);
assert.equal(formatHexAddress(0x400), "0x00000400");

// 自动模式不携带地址参数
const auto = buildRttStartOptions(base, 1);
assert.ok("options" in auto);
assert.equal(auto.options.scan_mode, "auto");
assert.equal(auto.options.address, undefined);
assert.equal(auto.options.range_start, undefined);

// 指定地址只带 address
const exact = buildRttStartOptions({ ...base, scanMode: "exact", scanAddress: 0x20001000 }, 1);
assert.ok("options" in exact);
assert.equal(exact.options.address, 0x20001000);
assert.equal(exact.options.range_start, undefined);

// 地址范围：起始与大小都要传给后端（旧版本漏传，范围模式实际不可用）
const range = buildRttStartOptions({ ...base, scanMode: "range", scanAddress: 0x20000000, rangeSize: 0x8000 }, 1);
assert.ok("options" in range);
assert.equal(range.options.range_start, 0x20000000);
assert.equal(range.options.range_size, 0x8000);
assert.ok("error" in buildRttStartOptions({ ...base, scanMode: "range", rangeSize: 0 }, 1));

// ELF 模式必须选择文件
assert.ok("error" in buildRttStartOptions({ ...base, scanMode: "elf", elfPath: "  " }, 1));
const elf = buildRttStartOptions({ ...base, scanMode: "elf", elfPath: " C:/fw/app.elf " }, 1);
assert.ok("options" in elf);
assert.equal(elf.options.elf_path, "C:/fw/app.elf");

// 轮询间隔夹在 1..1000；单核芯片忽略残留的核心选择，多核时夹到有效范围
const clamped = buildRttStartOptions({ ...base, pollInterval: 0, coreIndex: 3 }, 1);
assert.ok("options" in clamped);
assert.equal(clamped.options.poll_interval, 10);
assert.equal(clamped.options.core_index, 0);
const multi = buildRttStartOptions({ ...base, pollInterval: 5000, coreIndex: 3 }, 2);
assert.ok("options" in multi);
assert.equal(multi.options.poll_interval, 1000);
assert.equal(multi.options.core_index, 1);
assert.equal(multi.options.halt_on_read, false);
assert.equal(multi.options.recover_timeout_ms, 10_000);

// base64 批次解码保留通道与全部字节值（含 0x00 / 0xFF）
const bytes = [0x00, 0x41, 0x0a, 0x80, 0xff];
const batch = {
  timestamp: 1,
  chunks: [
    { channel: 0, data: Buffer.from(bytes).toString("base64") },
    { channel: 2, data: Buffer.from("hi\n").toString("base64") },
    { channel: 1, data: "" },
  ],
};
const decoded = decodeRttChunks(batch);
assert.deepEqual(decoded, [
  { channel: 0, data: bytes },
  { channel: 2, data: [0x68, 0x69, 0x0a] },
  { channel: 1, data: [] },
]);

console.log("RTT 启动参数与数据解码检查通过");
