import { invoke } from "@tauri-apps/api/core";
import type { ConnectOptions, ConnectionInfo } from "./types";

export interface DebugAttachOptions extends ConnectOptions {
  halt_after_attach?: boolean;
}

export interface DebugCoreState {
  state: "halted" | "running";
  pc: number | null;
}

export interface DebugStatus {
  attached: boolean;
  info: ConnectionInfo | null;
  core: DebugCoreState | null;
}

export interface DebugRegisterValue {
  name: string;
  value: number;
}

export type ElfSymbolCategory = "function" | "variable";

export interface ElfSymbol {
  name: string;
  address: number;
  size: number;
  category: ElfSymbolCategory;
}

export interface DebugLoadElfResult {
  path: string;
  function_count: number;
  variable_count: number;
  symbols: ElfSymbol[];
}

export interface DebugFrame {
  id: number;
  pc: number;
  function: string | null;
  file: string | null;
  line: number | null;
}

export interface DebugBreakpointEntry {
  id: number;
  address: number;
  enabled: boolean;
  hit_count: number;
  file: string | null;
  line: number | null;
}

export interface DebugReadSourceResult {
  path: string;
  content: string;
}

// Attach / Detach
export async function debugAttach(options: DebugAttachOptions): Promise<DebugStatus> {
  return await invoke<DebugStatus>("debug_attach", { options });
}

export async function debugDetach(): Promise<void> {
  return await invoke("debug_detach");
}

export async function debugGetStatus(): Promise<DebugStatus> {
  return await invoke<DebugStatus>("debug_get_status");
}

// 执行控制
export async function debugRun(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_run");
}

export async function debugHalt(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_halt");
}

export async function debugStepIn(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_step_in");
}

export async function debugStepOver(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_step_over");
}

export async function debugStepOut(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_step_out");
}

export async function debugReset(): Promise<DebugCoreState> {
  return await invoke<DebugCoreState>("debug_reset");
}

// 内存读写
// 后端以原始二进制返回；调用方按普通数组做格式化，读取量小（面板级），直接转换即可
export async function debugReadMemory(address: number, size: number): Promise<number[]> {
  return Array.from(new Uint8Array(await invoke<ArrayBuffer>("debug_read_memory", { options: { address, size } })));
}

// 寄存器读写
export async function debugReadRegisters(): Promise<DebugRegisterValue[]> {
  return await invoke<DebugRegisterValue[]>("debug_read_registers");
}

// ELF / DWARF
export async function debugLoadElf(path: string): Promise<DebugLoadElfResult> {
  return await invoke<DebugLoadElfResult>("debug_load_elf", { path });
}

export async function debugClearSymbols(): Promise<void> {
  return await invoke("debug_clear_symbols");
}

export async function debugGetCallStack(): Promise<DebugFrame[]> {
  return await invoke<DebugFrame[]>("debug_get_call_stack");
}

// 断点
export async function debugSetBreakpoint(address: number): Promise<DebugBreakpointEntry> {
  return await invoke<DebugBreakpointEntry>("debug_set_breakpoint", { options: { address } });
}

export async function debugSetSourceBreakpoint(file: string, line: number): Promise<DebugBreakpointEntry> {
  return await invoke<DebugBreakpointEntry>("debug_set_source_breakpoint", {
    options: { file, line },
  });
}

export async function debugClearBreakpoint(address: number): Promise<void> {
  return await invoke("debug_clear_breakpoint", { options: { address } });
}

export async function debugListBreakpoints(): Promise<DebugBreakpointEntry[]> {
  return await invoke<DebugBreakpointEntry[]>("debug_list_breakpoints");
}

export async function debugClearAllBreakpoints(): Promise<void> {
  return await invoke("debug_clear_all_breakpoints");
}

// 源码
export async function debugReadSource(path: string): Promise<DebugReadSourceResult> {
  return await invoke<DebugReadSourceResult>("debug_read_source", { path });
}
