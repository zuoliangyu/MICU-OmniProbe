import { create } from "zustand";
import type { EraseMode } from "@/lib/types";
import { loadFromStorage, saveToStorage } from "@/lib/storage";

// Flash settings persistence key
const FLASH_SETTINGS_KEY = "flash_settings";

interface FlashSettings {
  verifyAfterFlash: boolean;
  resetAfterFlash: boolean;
  eraseMode: EraseMode;
}

const defaultFlashSettings: FlashSettings = {
  verifyAfterFlash: false, // 默认不校验（加快烧录速度）
  resetAfterFlash: true,
  eraseMode: "SectorErase",
};

interface FlashState {
  // 状态
  firmwarePath: string | null;
  firmwareSize: number;
  flashing: boolean;
  progress: number;
  phase: string;
  message: string;
  verifyAfterFlash: boolean;
  resetAfterFlash: boolean;
  eraseMode: EraseMode;

  // 自定义烧录地址
  useCustomAddress: boolean;
  customFlashAddress: number;

  // 操作
  setFirmwarePath: (path: string | null) => void;
  setFirmwareSize: (size: number) => void;
  setFlashing: (flashing: boolean) => void;
  setProgress: (progress: number, phase?: string, message?: string) => void;
  setVerifyAfterFlash: (verify: boolean) => void;
  setResetAfterFlash: (reset: boolean) => void;
  setEraseMode: (mode: EraseMode) => void;
  setUseCustomAddress: (use: boolean) => void;
  setCustomFlashAddress: (address: number) => void;
  reset: () => void;
}

export const useFlashStore = create<FlashState>((set, get) => {
  const savedSettings = loadFromStorage(FLASH_SETTINGS_KEY, defaultFlashSettings);

  return {
    firmwarePath: null,
    firmwareSize: 0,
    flashing: false,
    progress: 0,
    phase: "",
    message: "",
    verifyAfterFlash: savedSettings.verifyAfterFlash,
    resetAfterFlash: savedSettings.resetAfterFlash,
    eraseMode: savedSettings.eraseMode,

    useCustomAddress: false,
    customFlashAddress: 0x08000000,

    setFirmwarePath: (firmwarePath) => set({ firmwarePath }),

    setFirmwareSize: (firmwareSize) => set({ firmwareSize }),

    setFlashing: (flashing) => set({ flashing }),

    setProgress: (progress, phase, message) =>
      set((state) => ({
        progress,
        phase: phase ?? state.phase,
        message: message ?? state.message,
      })),

    setVerifyAfterFlash: (verifyAfterFlash) => {
      set({ verifyAfterFlash });
      const state = get();
      saveToStorage(FLASH_SETTINGS_KEY, {
        verifyAfterFlash,
        resetAfterFlash: state.resetAfterFlash,
        eraseMode: state.eraseMode,
      });
    },

    setResetAfterFlash: (resetAfterFlash) => {
      set({ resetAfterFlash });
      const state = get();
      saveToStorage(FLASH_SETTINGS_KEY, {
        verifyAfterFlash: state.verifyAfterFlash,
        resetAfterFlash,
        eraseMode: state.eraseMode,
      });
    },

    setEraseMode: (eraseMode) => {
      set({ eraseMode });
      const state = get();
      saveToStorage(FLASH_SETTINGS_KEY, {
        verifyAfterFlash: state.verifyAfterFlash,
        resetAfterFlash: state.resetAfterFlash,
        eraseMode,
      });
    },

    setUseCustomAddress: (useCustomAddress) => set({ useCustomAddress }),

    setCustomFlashAddress: (customFlashAddress) => set({ customFlashAddress }),

    reset: () =>
      set({
        firmwarePath: null,
        firmwareSize: 0,
        flashing: false,
        progress: 0,
        phase: "",
        message: "",
      }),
  };
});
