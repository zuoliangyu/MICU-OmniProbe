/**
 * 烧录项目文件（.omniproj，JSON）：保存固件路径、目标芯片、接口设置与烧录设置，打开时一键恢复。
 */

import { useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@/lib/tauri";
import type { DeviceSettings, EraseMode } from "@/lib/types";
import { selectTargetChip, useProbeStore } from "@/stores/probeStore";
import { useChipStore } from "@/stores/chipStore";
import { useFlashStore } from "@/stores/flashStore";
import { useLogStore } from "@/stores/logStore";
import { useFirmwareFile } from "./useFirmwareFile";

const PROJECT_FORMAT = "micu-omniprobe-flash-project";
const PROJECT_VERSION = 1;
const PROJECT_FILTERS = [{ name: "OmniProbe 烧录项目", extensions: ["omniproj"] }];

type ProjectDeviceSettings = Pick<DeviceSettings, "interfaceType" | "clockSpeed" | "connectMode" | "resetMode">;

interface ProjectFlashSettings {
  verifyAfterFlash: boolean;
  resetAfterFlash: boolean;
  eraseMode: EraseMode;
  useCustomAddress: boolean;
  customFlashAddress: number;
}

/** 项目内容；从文件读出时缺失或非法的字段为 undefined，恢复时跳过 */
interface FlashProject {
  firmwarePath?: string;
  chip?: string;
  device: Partial<ProjectDeviceSettings>;
  flash: Partial<ProjectFlashSettings>;
}

function captureProject(): FlashProject {
  const { settings } = useProbeStore.getState();
  const flash = useFlashStore.getState();
  return {
    firmwarePath: flash.firmwarePath ?? undefined,
    chip: useChipStore.getState().selectedChip ?? undefined,
    device: {
      interfaceType: settings.interfaceType,
      clockSpeed: settings.clockSpeed,
      connectMode: settings.connectMode,
      resetMode: settings.resetMode,
    },
    flash: {
      verifyAfterFlash: flash.verifyAfterFlash,
      resetAfterFlash: flash.resetAfterFlash,
      eraseMode: flash.eraseMode,
      useCustomAddress: flash.useCustomAddress,
      customFlashAddress: flash.customFlashAddress,
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function nonNegativeInt(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseProject(content: string): FlashProject {
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(content));
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (raw.format !== PROJECT_FORMAT) throw new Error("不是 OmniProbe 烧录项目文件");

  const device = record(raw.device);
  const flash = record(raw.flash);
  return {
    firmwarePath: text(raw.firmwarePath),
    chip: text(raw.chip),
    device: {
      interfaceType: oneOf(device.interfaceType, ["SWD", "JTAG"] as const),
      clockSpeed: nonNegativeInt(device.clockSpeed),
      connectMode: oneOf(device.connectMode, ["Normal", "UnderReset"] as const),
      resetMode: oneOf(device.resetMode, ["Software", "Hardware"] as const),
    },
    flash: {
      verifyAfterFlash: bool(flash.verifyAfterFlash),
      resetAfterFlash: bool(flash.resetAfterFlash),
      eraseMode: oneOf(flash.eraseMode, ["SectorErase", "ChipErase"] as const),
      useCustomAddress: bool(flash.useCustomAddress),
      customFlashAddress: nonNegativeInt(flash.customFlashAddress),
    },
  };
}

/** 去掉值为 undefined 的字段，避免覆盖现有设置 */
function defined<T extends object>(value: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function useFlashProject() {
  const addLog = useLogStore((state) => state.addLog);
  const { selectFirmware } = useFirmwareFile();

  const saveProject = useCallback(async () => {
    const project = captureProject();
    const fileName = project.firmwarePath?.split(/[\\/]/).pop() ?? "";
    const baseName = fileName.replace(/\.[^.]+$/, "") || "flash-project";
    const path = await save({ defaultPath: `${baseName}.omniproj`, filters: PROJECT_FILTERS });
    if (!path) return;

    try {
      const content = JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...project }, null, 2);
      await writeTextFile(path, content);
      addLog("success", `项目已保存: ${path}`);
    } catch (error) {
      addLog("error", `保存项目失败: ${error}`);
    }
  }, [addLog]);

  const openProject = useCallback(async () => {
    const path = await open({ multiple: false, filters: PROJECT_FILTERS });
    if (typeof path !== "string") return;

    let project: FlashProject;
    try {
      project = parseProject(await readTextFile(path));
    } catch (error) {
      addLog("error", `打开项目失败: ${error instanceof Error ? error.message : error}`);
      return;
    }

    const { connected, settings, setSettings } = useProbeStore.getState();
    const device = defined(project.device);
    if (connected) {
      // 连接期间接口与芯片不能改，只恢复随时可切换的复位方式
      if (device.resetMode) setSettings({ resetMode: device.resetMode });
      const chipDiffers = project.chip !== undefined && project.chip !== useChipStore.getState().selectedChip;
      const deviceDiffers = (["interfaceType", "clockSpeed", "connectMode"] as const).some(
        (key) => device[key] !== undefined && device[key] !== settings[key]
      );
      if (chipDiffers || deviceDiffers) {
        addLog("warn", "当前已连接，项目中的芯片与接口设置未应用；断开连接后重新打开项目即可全部恢复");
      }
    } else {
      setSettings(device);
      if (project.chip) {
        try {
          await selectTargetChip(project.chip);
        } catch (error) {
          addLog("warn", `项目芯片 ${project.chip} 加载失败（可能需要先导入对应 Pack）: ${error}`);
        }
      }
    }

    const flash = useFlashStore.getState();
    const { verifyAfterFlash, resetAfterFlash, eraseMode, useCustomAddress, customFlashAddress } = project.flash;
    if (verifyAfterFlash !== undefined) flash.setVerifyAfterFlash(verifyAfterFlash);
    if (resetAfterFlash !== undefined) flash.setResetAfterFlash(resetAfterFlash);
    if (eraseMode !== undefined) flash.setEraseMode(eraseMode);
    if (useCustomAddress !== undefined) flash.setUseCustomAddress(useCustomAddress);
    if (customFlashAddress !== undefined) flash.setCustomFlashAddress(customFlashAddress);

    if (project.firmwarePath) await selectFirmware(project.firmwarePath);

    addLog("success", `项目已打开: ${path}`);
  }, [addLog, selectFirmware]);

  return { saveProject, openProject };
}
