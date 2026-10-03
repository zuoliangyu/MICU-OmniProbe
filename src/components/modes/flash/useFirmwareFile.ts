import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getFirmwareInfo } from "@/lib/tauri";
import { useFlashStore } from "@/stores/flashStore";
import { useLogStore } from "@/stores/logStore";

export const FIRMWARE_EXTENSIONS = ["hex", "bin", "elf", "axf", "out", "ihex"];

export function isFirmwareFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return FIRMWARE_EXTENSIONS.some((ext) => lowerPath.endsWith(`.${ext}`));
}

/** 选择固件文件：工具栏按钮、固件卡片和拖放共用，统一读取文件大小并写日志 */
export function useFirmwareFile() {
  const setFirmwarePath = useFlashStore((state) => state.setFirmwarePath);
  const setFirmwareSize = useFlashStore((state) => state.setFirmwareSize);
  const addLog = useLogStore((state) => state.addLog);

  const selectFirmware = useCallback(
    async (file: string) => {
      setFirmwarePath(file);
      setFirmwareSize(0);
      try {
        const fileInfo = await getFirmwareInfo(file);
        if (fileInfo.exists) {
          setFirmwareSize(fileInfo.size);
          const sizeKB = (fileInfo.size / 1024).toFixed(1);
          addLog("info", `已选择固件文件: ${file.split(/[\\/]/).pop()} (${sizeKB} KB)`);
        } else {
          addLog("warn", `已选择固件文件: ${file} (文件不存在)`);
        }
      } catch {
        addLog("info", `已选择固件文件: ${file}`);
      }
    },
    [setFirmwarePath, setFirmwareSize, addLog]
  );

  const openFirmwareDialog = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [
        { name: "固件文件", extensions: FIRMWARE_EXTENSIONS },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (file) await selectFirmware(file);
  }, [selectFirmware]);

  return { selectFirmware, openFirmwareDialog };
}
