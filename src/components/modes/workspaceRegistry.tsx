// 本文件是工作台注册表而非组件模块：导出的是 WORKSPACE_REGISTRY / WORKSPACE_BY_MODE 数据，
// 里面的 lazy() 只是表项的值，对它做 fast refresh 没有意义。
/* eslint-disable react-refresh/only-export-components */
import { lazy, type ComponentType } from "react";
import {
  Bluetooth,
  Bug,
  Cpu,
  FileSearch,
  LayoutDashboard,
  Plug2,
  Radar,
  Terminal,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { WORKSPACES, type AppMode } from "@/lib/workspaces";

// 七个工作台改为按需加载：图标仍需同步（模式轨道和顶栏要立即渲染），
// 只有工作区本体延迟到实际切换过去时才拉取。
// 调试工作台独占 CodeMirror + dockview，串口/RTT 独占 recharts，
// 全部静态 import 会把它们塞进首屏 chunk。
const FlashMode = lazy(() => import("./FlashMode").then((m) => ({ default: m.FlashMode })));
const RttMode = lazy(() => import("./RttMode").then((m) => ({ default: m.RttMode })));
const SerialMode = lazy(() => import("./SerialMode").then((m) => ({ default: m.SerialMode })));
const LogAnalysisMode = lazy(() => import("./LogAnalysisMode").then((m) => ({ default: m.LogAnalysisMode })));
const BluetoothMode = lazy(() => import("./BluetoothMode").then((m) => ({ default: m.BluetoothMode })));
const ControlPanelMode = lazy(() => import("./ControlPanelMode").then((m) => ({ default: m.ControlPanelMode })));
const DebugMode = lazy(() => import("./DebugMode").then((m) => ({ default: m.DebugMode })));

interface WorkspaceUi {
  navigationIcon: LucideIcon;
  headerIcon: LucideIcon;
  view: ComponentType;
}

const WORKSPACE_UI: Record<AppMode, WorkspaceUi> = {
  flash: { navigationIcon: Zap, headerIcon: Cpu, view: FlashMode },
  rtt: { navigationIcon: Terminal, headerIcon: Radar, view: RttMode },
  serial: { navigationIcon: Plug2, headerIcon: Plug2, view: SerialMode },
  "log-analysis": { navigationIcon: FileSearch, headerIcon: FileSearch, view: LogAnalysisMode },
  bluetooth: { navigationIcon: Bluetooth, headerIcon: Bluetooth, view: BluetoothMode },
  "control-panel": { navigationIcon: LayoutDashboard, headerIcon: LayoutDashboard, view: ControlPanelMode },
  debug: { navigationIcon: Bug, headerIcon: Bug, view: DebugMode },
};

export const WORKSPACE_REGISTRY = WORKSPACES.map((workspace) => ({ ...workspace, ...WORKSPACE_UI[workspace.id] }));

export const WORKSPACE_BY_MODE = Object.fromEntries(
  WORKSPACE_REGISTRY.map((workspace) => [workspace.id, workspace])
) as Record<AppMode, (typeof WORKSPACE_REGISTRY)[number]>;
