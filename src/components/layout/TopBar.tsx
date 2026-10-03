import { Activity, Cpu, FileCode, Loader2, PanelRightClose, PanelRightOpen, Radar } from "lucide-react";
import { UpdateChecker } from "../UpdateChecker";
import { useProbeStore } from "@/stores/probeStore";
import { useRttStore } from "@/stores/rttStore";
import { useFlashStore } from "@/stores/flashStore";
import { useChipStore } from "@/stores/chipStore";
import { useAppStore } from "@/stores/appStore";
import { useBluetoothStore } from "@/stores/bluetoothStore";
import { useSerialStore } from "@/stores/serialStore";
import { useControlPanelStore } from "@/stores/controlPanelStore";
import { formatDebugStatus, useDebugStore } from "@/stores/debugStore";
import { cn } from "@/lib/utils";
import { TooltipWrapper } from "@/components/ui/tooltip-button";
import { formatBytes } from "@/lib/formatters";
import { SettingsCenterButton } from "./SettingsCenterButton";
import { Button } from "@/components/ui/button";
import { WORKSPACE_BY_MODE } from "@/components/modes/workspaceRegistry";

interface TopBarProps {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function TopBar({ inspectorOpen, onToggleInspector }: TopBarProps) {
  const probeConnected = useProbeStore((state) => state.connected);
  const selectedProbe = useProbeStore((state) => state.selectedProbe);
  const rttConnected = useRttStore((state) => state.rttConnected);
  const rttRunning = useRttStore((state) => state.isRunning);
  const totalBytes = useRttStore((state) => state.totalBytes);
  const flashing = useFlashStore((state) => state.flashing);
  const progress = useFlashStore((state) => state.progress);
  const firmwarePath = useFlashStore((state) => state.firmwarePath);
  const selectedChip = useChipStore((state) => state.selectedChip);
  const mode = useAppStore((state) => state.mode);
  const serialConnected = useSerialStore((state) => state.connected);
  const bluetoothConnected = useBluetoothStore((state) => state.connected);
  const controlPanelSource = useControlPanelStore((state) => state.source);
  const firmwareFileName = firmwarePath?.split(/[\\/]/).pop();
  const debugState = useDebugStore((state) => state.state);
  const haltReason = useDebugStore((state) => state.haltReason);
  const pc = useDebugStore((state) => state.pc);
  const loadedElfPath = useDebugStore((state) => state.loadedElfPath);
  const elfFileName = loadedElfPath?.split(/[\\/]/).pop();
  const { label, headerIcon: ModeIcon } = WORKSPACE_BY_MODE[mode];
  const connectionLabel =
    mode === "serial"
      ? "串口"
      : mode === "bluetooth"
        ? "蓝牙"
        : mode === "control-panel"
          ? controlPanelSource === "rtt"
            ? "RTT"
            : "串口"
          : "探针";
  const connected =
    mode === "serial"
      ? serialConnected
      : mode === "bluetooth"
        ? bluetoothConnected
        : mode === "control-panel"
          ? controlPanelSource === "serial"
            ? serialConnected
            : rttConnected
          : probeConnected;

  return (
    <header className="ide-topbar surface-shell no-select flex h-full min-w-0 items-center gap-3 rounded-[14px] px-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/12 text-primary">
          <ModeIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{label}</div>
          <div className="ide-topbar-subtitle text-xs text-muted-foreground">MICU-OmniProbe</div>
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-2 xl:flex">
        {mode !== "log-analysis" && selectedChip && (
          <TooltipWrapper tooltip="当前目标芯片">
            <div className="toolbar-chip-strong flex min-w-0 items-center gap-1.5 px-2.5 py-1.5">
              <Cpu className="h-3.5 w-3.5" />
              <span className="truncate font-mono text-xs">{selectedChip}</span>
            </div>
          </TooltipWrapper>
        )}
        {mode !== "log-analysis" && selectedProbe && (
          <TooltipWrapper tooltip={selectedProbe.identifier}>
            <div className="toolbar-chip flex min-w-0 items-center gap-1.5 px-2.5 py-1.5">
              <Activity className="h-3.5 w-3.5" />
              <span className="max-w-[150px] truncate text-xs">{selectedProbe.identifier}</span>
            </div>
          </TooltipWrapper>
        )}
        {mode === "debug" && (
          <TooltipWrapper tooltip={loadedElfPath ?? "点击工具栏「加载 ELF…」加载固件符号"}>
            <div className="toolbar-chip flex max-w-[220px] items-center gap-1.5 px-2.5 py-1.5">
              <FileCode className="h-3.5 w-3.5 shrink-0" />
              <span className={cn("truncate text-xs", !elfFileName && "text-muted-foreground")}>
                {elfFileName ?? "未加载 ELF"}
              </span>
            </div>
          </TooltipWrapper>
        )}
        {mode === "flash" && firmwareFileName && (
          <TooltipWrapper tooltip={firmwarePath}>
            <div className="toolbar-chip flex max-w-[220px] items-center gap-1.5 px-2.5 py-1.5">
              <FileCode className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-xs">{firmwareFileName}</span>
            </div>
          </TooltipWrapper>
        )}
        {mode === "rtt" && rttRunning && (
          <div className="toolbar-chip flex items-center gap-1.5 px-2.5 py-1.5">
            <Radar className="h-3.5 w-3.5" />
            <span className="text-xs">{formatBytes(totalBytes)}</span>
          </div>
        )}
        {flashing && (
          <div className="toolbar-chip flex items-center gap-2 px-2.5 py-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all duration-200" style={{ width: progress + "%" }} />
            </div>
            <span className="w-9 text-xs font-medium text-primary">{Math.round(progress)}%</span>
          </div>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <UpdateChecker showTrigger={false} />
        <SettingsCenterButton />
        {mode !== "control-panel" && mode !== "log-analysis" && (
          <Button
            size="sm"
            variant="outline"
            className="px-2"
            onClick={onToggleInspector}
            title={inspectorOpen ? "收起配置检查器" : "展开配置检查器"}
            aria-label={inspectorOpen ? "收起配置检查器" : "展开配置检查器"}
          >
            {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        )}
        {mode !== "log-analysis" && rttConnected && !rttRunning && (
          <span className="status-chip hidden items-center gap-1.5 xl:flex">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            RTT 就绪
          </span>
        )}
        {mode === "debug" ? (
          // 调试工作台通过工具栏附加独立会话，不走 probeStore.connected，状态要看调试会话本身
          <span className="status-chip flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                debugState === "halted" ? "bg-yellow-500" : debugState === "detached" ? "bg-red-500" : "bg-green-500"
              )}
            />
            <span
              className={cn(
                "font-mono",
                debugState === "halted"
                  ? "text-yellow-700"
                  : debugState === "detached"
                    ? "text-red-500"
                    : "text-green-600"
              )}
            >
              {formatDebugStatus(debugState, haltReason, pc)}
            </span>
          </span>
        ) : (
          mode !== "log-analysis" && (
            <span className="status-chip flex items-center gap-1.5">
              <span className={connected ? "h-2 w-2 rounded-full bg-green-500" : "h-2 w-2 rounded-full bg-red-500"} />
              <span className={connected ? "text-green-600" : "text-red-500"}>
                {connectionLabel}
                {connected ? "已连接" : "未连接"}
              </span>
            </span>
          )
        )}
      </div>
    </header>
  );
}
