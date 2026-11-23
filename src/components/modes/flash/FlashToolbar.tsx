/**
 * Flash 模式工具栏组件
 */

import { useState, useEffect } from "react";
import {
  FolderOpen,
  FolderInput,
  Save,
  Unlock,
  Trash2,
  CheckCircle,
  Upload,
  Zap,
  RotateCcw,
  Square,
  Play,
} from "lucide-react";
import { TooltipButton, TooltipWrapper } from "@/components/ui/tooltip-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildConnectOptions, useProbeStore } from "@/stores/probeStore";
import { useChipStore } from "@/stores/chipStore";
import { useFlashStore } from "@/stores/flashStore";
import { useLogStore } from "@/stores/logStore";
import { save } from "@tauri-apps/plugin-dialog";
import { useFirmwareFile } from "./useFirmwareFile";
import { useFlashProject } from "./useFlashProject";
import {
  flashFirmware,
  eraseChip,
  eraseSector,
  verifyFirmware,
  readFlash,
  getFirmwareInfo,
  writeBinaryFile,
  resetTarget,
  haltTarget,
  resumeTarget,
  unlockChip,
  getConnectionStatus,
} from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { RESET_MODE_LABELS, type FlashProgressEvent, type EraseMode } from "@/lib/types";
import { formatHex } from "@/lib/utils";
import { EraseDialog } from "@/components/dialogs/EraseDialog";
import { ReadFlashDialog } from "@/components/dialogs/ReadFlashDialog";
import { UnlockChipDialog } from "@/components/dialogs/UnlockChipDialog";
import { useShallow } from "zustand/react/shallow";

function ToolbarSeparator() {
  return <div className="mx-1 h-6 w-px bg-border min-[1101px]:mx-2" />;
}

export function FlashToolbar() {
  const { connected, connecting, selectedProbe, settings, targetInfo, setConnected } = useProbeStore(
    useShallow((state) => ({
      connected: state.connected,
      connecting: state.loading,
      selectedProbe: state.selectedProbe,
      settings: state.settings,
      targetInfo: state.targetInfo,
      setConnected: state.setConnected,
    }))
  );
  const selectedChip = useChipStore((state) => state.selectedChip);
  const {
    firmwarePath,
    flashing,
    setFlashing,
    setProgress,
    setFirmwareSize,
    verifyAfterFlash,
    resetAfterFlash,
    eraseMode,
    setEraseMode,
    useCustomAddress,
    customFlashAddress,
  } = useFlashStore(
    useShallow((state) => ({
      firmwarePath: state.firmwarePath,
      flashing: state.flashing,
      setFlashing: state.setFlashing,
      setProgress: state.setProgress,
      setFirmwareSize: state.setFirmwareSize,
      verifyAfterFlash: state.verifyAfterFlash,
      resetAfterFlash: state.resetAfterFlash,
      eraseMode: state.eraseMode,
      setEraseMode: state.setEraseMode,
      useCustomAddress: state.useCustomAddress,
      customFlashAddress: state.customFlashAddress,
    }))
  );
  const addLog = useLogStore((state) => state.addLog);
  const [eraseDialogOpen, setEraseDialogOpen] = useState(false);
  const [readDialogOpen, setReadDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const { openFirmwareDialog } = useFirmwareFile();
  const { saveProject, openProject } = useFlashProject();

  const flashRegions = targetInfo?.memory_regions.filter((region) => region.kind === "Flash") ?? [];
  const deviceBusy = !connected || flashing;

  useEffect(() => {
    const unlisten = listen<FlashProgressEvent>("flash-progress", (event) => {
      const { phase, progress, message } = event.payload;
      setProgress(progress * 100, phase, message);
      addLog("info", message);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setProgress, addLog]);

  const handleFlash = async () => {
    if (!firmwarePath) {
      addLog("error", "请先选择固件文件");
      return;
    }

    if (!connected) {
      addLog("error", "请先连接设备");
      return;
    }

    try {
      setFlashing(true);
      setProgress(0, "init", "重载固件文件...");

      // 烧录前重载固件文件信息
      const fileInfo = await getFirmwareInfo(firmwarePath);
      if (!fileInfo.exists) {
        addLog("error", `固件文件不存在: ${firmwarePath}`);
        setFlashing(false);
        return;
      }

      setFirmwareSize(fileInfo.size);
      const sizeKB = (fileInfo.size / 1024).toFixed(1);
      addLog("info", `已重载固件文件: ${firmwarePath.split(/[\\/]/).pop()} (${sizeKB} KB)`);

      setProgress(0, "init", "开始烧录");
      addLog("info", `开始烧录: ${firmwarePath}`);

      await flashFirmware({
        file_path: firmwarePath,
        verify: verifyAfterFlash,
        skip_erase: false,
        reset_after: resetAfterFlash,
        erase_mode: eraseMode,
        use_custom_address: useCustomAddress,
        custom_flash_address: useCustomAddress ? customFlashAddress : undefined,
        reset_mode: settings.resetMode,
      });

      addLog("success", "烧录成功");
    } catch (error) {
      addLog("error", `烧录失败: ${error}`);
    } finally {
      setFlashing(false);
    }
  };

  const handleErase = async () => {
    if (!connected) {
      addLog("error", "请先连接设备");
      return;
    }
    setEraseDialogOpen(true);
  };

  const handleEraseConfirm = async (mode: "full" | "custom", address?: number, size?: number) => {
    try {
      setFlashing(true);

      if (mode === "full") {
        addLog("info", "开始全片擦除");
        await eraseChip();
        addLog("success", "全片擦除完成");
      } else if (mode === "custom" && address !== undefined && size !== undefined) {
        addLog(
          "info",
          `开始擦除 0x${address.toString(16).toUpperCase()} - 0x${(address + size).toString(16).toUpperCase()} (${size} 字节)`
        );
        await eraseSector(address, size);
        addLog("success", "自定义范围擦除完成");
      }
    } catch (error) {
      addLog("error", `擦除失败: ${error}`);
    } finally {
      setFlashing(false);
    }
  };

  const handleVerify = async () => {
    if (!firmwarePath) {
      addLog("error", "请先选择固件文件");
      return;
    }

    if (!connected) {
      addLog("error", "请先连接设备");
      return;
    }

    try {
      setFlashing(true);
      addLog("info", "开始校验");
      // 与烧录使用同一地址，否则自定义地址烧录的 BIN 必定校验不匹配（HEX / ELF 自带地址，后端忽略）
      const result = await verifyFirmware(firmwarePath, useCustomAddress ? customFlashAddress : undefined);
      if (result) {
        addLog("success", "校验通过");
      } else {
        addLog("error", "校验失败");
      }
    } catch (error) {
      addLog("error", `校验失败: ${error}`);
    } finally {
      setFlashing(false);
    }
  };

  const handleReadConfirm = async (address: number, size: number) => {
    const path = await save({
      defaultPath: `${selectedChip ?? "flash"}_${formatHex(address)}_${size}B.bin`,
      filters: [{ name: "二进制文件", extensions: ["bin"] }],
    });
    if (!path) return;

    try {
      setFlashing(true);
      addLog("info", `开始读取 Flash: ${formatHex(address)} 起 ${size} 字节`);
      const data = await readFlash(address, size);
      await writeBinaryFile(path, data);
      addLog("success", `已读取 ${data.length} 字节到 ${path}`);
    } catch (error) {
      addLog("error", `读取失败: ${error}`);
    } finally {
      setFlashing(false);
    }
  };

  const handleUnlockConfirm = async () => {
    if (!selectedProbe || !selectedChip) return;
    try {
      setFlashing(true);
      setProgress(0, "erase", "正在解锁芯片...");
      addLog("warn", `开始解锁 ${selectedChip}：将擦除全部 Flash`);
      const target = await unlockChip(buildConnectOptions(selectedProbe, selectedChip, settings));
      const status = await getConnectionStatus();
      setConnected(true, status.info, target);
      addLog("success", `${selectedChip} 已解锁并完成全片擦除，连接已保持`);
    } catch (error) {
      // 后端在解锁前已关闭原有烧录连接
      setConnected(false);
      addLog("error", `解锁失败: ${error}`);
    } finally {
      setFlashing(false);
    }
  };

  /** 复位 / 停止 / 运行：耗时很短，只记录结果 */
  const runTargetControl = async (label: string, action: () => Promise<string>) => {
    try {
      addLog("success", await action());
    } catch (error) {
      addLog("error", `${label}失败: ${error}`);
    }
  };

  const handleReset = () =>
    runTargetControl("复位", async () => {
      await resetTarget(settings.resetMode);
      return `已复位芯片（${RESET_MODE_LABELS[settings.resetMode]}）`;
    });

  const handleHalt = () => runTargetControl("停止", async () => `内核已停止，PC = ${formatHex(await haltTarget())}`);

  const handleResume = () =>
    runTargetControl("运行", async () => {
      await resumeTarget();
      return "内核已恢复运行";
    });

  return (
    <div className="flex items-center h-10 px-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-1">
        {/* File operations */}
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<FolderOpen className="h-4 w-4" />}
          tooltip="打开固件文件"
          onClick={openFirmwareDialog}
        />
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<FolderInput className="h-4 w-4" />}
          tooltip="打开项目（恢复固件、芯片与烧录设置）"
          disabled={flashing}
          onClick={openProject}
        />
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<Save className="h-4 w-4" />}
          tooltip="保存项目"
          onClick={saveProject}
        />
        <ToolbarSeparator />

        {/* Device operations */}
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<Unlock className="h-4 w-4" />}
          tooltip="解锁芯片（整片擦除以解除读保护，未连接也可使用）"
          disabled={flashing || connecting || !selectedProbe || !selectedChip}
          onClick={() => setUnlockDialogOpen(true)}
        />
        <ToolbarSeparator />

        {/* Flash operations */}
        <TooltipButton
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          icon={<Trash2 className="h-4 w-4" />}
          tooltip="擦除 Flash"
          disabled={deviceBusy}
          onClick={handleErase}
        >
          擦除
        </TooltipButton>

        {/* Erase mode selector */}
        <TooltipWrapper tooltip="烧录时的擦除模式：扇区擦除只擦除需要写入的区域（快），整片擦除会清空整个Flash（慢但彻底）">
          <div className="flex items-center gap-1">
            <span className="hidden text-xs text-muted-foreground min-[1101px]:inline">烧录模式:</span>
            <Select value={eraseMode} onValueChange={(value) => setEraseMode(value as EraseMode)} disabled={flashing}>
              <SelectTrigger className="w-[100px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SectorErase">扇区擦除</SelectItem>
                <SelectItem value="ChipErase">整片擦除</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TooltipWrapper>

        <TooltipButton
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          icon={<CheckCircle className="h-4 w-4" />}
          tooltip="校验 Flash 与固件是否一致（支持 HEX / BIN / ELF / AXF / OUT）"
          disabled={deviceBusy || !firmwarePath}
          onClick={handleVerify}
        >
          校验
        </TooltipButton>
        <TooltipButton
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs"
          icon={<Upload className="h-4 w-4" />}
          tooltip="读取 Flash 并保存为 BIN 文件"
          disabled={deviceBusy}
          onClick={() => setReadDialogOpen(true)}
        >
          读取
        </TooltipButton>
        <TooltipButton
          variant="default"
          size="sm"
          className="h-8 gap-1.5 px-3 text-xs"
          icon={<Zap className="h-4 w-4" />}
          tooltip="一键烧录"
          disabled={deviceBusy || !firmwarePath}
          onClick={handleFlash}
        >
          烧录
        </TooltipButton>
        <ToolbarSeparator />

        {/* Control operations */}
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<RotateCcw className="h-4 w-4" />}
          tooltip={`复位（${RESET_MODE_LABELS[settings.resetMode]}，可在配置检查器「接口设置」中切换）`}
          disabled={deviceBusy}
          onClick={handleReset}
        />
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<Square className="h-4 w-4" />}
          tooltip="停止（暂停内核）"
          disabled={deviceBusy}
          onClick={handleHalt}
        />
        <TooltipButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          icon={<Play className="h-4 w-4" />}
          tooltip="运行（恢复内核运行）"
          disabled={deviceBusy}
          onClick={handleResume}
        />
      </div>

      {/* Status display */}
      <div className="ml-auto hidden items-center gap-2 text-sm text-muted-foreground min-[1101px]:flex">
        {firmwarePath && (
          <span className="max-w-[200px] truncate text-xs" title={firmwarePath}>
            {firmwarePath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      {/* Dialogs */}
      <EraseDialog open={eraseDialogOpen} onOpenChange={setEraseDialogOpen} onConfirm={handleEraseConfirm} />
      <ReadFlashDialog
        open={readDialogOpen}
        onOpenChange={setReadDialogOpen}
        regions={flashRegions}
        onConfirm={handleReadConfirm}
      />
      <UnlockChipDialog
        open={unlockDialogOpen}
        onOpenChange={setUnlockDialogOpen}
        chipName={selectedChip ?? ""}
        onConfirm={handleUnlockConfirm}
      />
    </div>
  );
}
