import { create } from "zustand";
import type { ChipInfo, MemoryRegionInfo, FlashAlgorithmInfo } from "@/lib/types";
import { saveToStorage } from "@/lib/storage";

const RECENT_CHIPS_KEY = "recent_chips";
const RECENT_CHIPS_LIMIT = 8;

function loadRecentChips(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_CHIPS_KEY) ?? "[]");
    return Array.isArray(saved)
      ? saved.filter((chip): chip is string => typeof chip === "string" && chip.length > 0).slice(0, RECENT_CHIPS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

interface ChipState {
  // 状态
  chips: string[];
  searchResults: string[];
  selectedChip: string | null;
  chipInfo: ChipInfo | null;
  memoryRegions: MemoryRegionInfo[];
  flashAlgorithms: FlashAlgorithmInfo[];
  loading: boolean;
  searchQuery: string;
  /** 最近连接成功的芯片，最新的在前；选错的芯片连不上，不会进入列表 */
  recentChips: string[];

  // 操作
  setChips: (chips: string[]) => void;
  setSearchResults: (results: string[]) => void;
  selectChip: (chip: string | null) => void;
  setChipInfo: (info: ChipInfo | null) => void;
  setMemoryRegions: (regions: MemoryRegionInfo[]) => void;
  setFlashAlgorithms: (algorithms: FlashAlgorithmInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  addRecentChip: (chip: string) => void;
  reset: () => void;
}

export const useChipStore = create<ChipState>((set) => ({
  chips: [],
  searchResults: [],
  selectedChip: null,
  chipInfo: null,
  memoryRegions: [],
  flashAlgorithms: [],
  loading: false,
  searchQuery: "",
  recentChips: loadRecentChips(),

  setChips: (chips) => set({ chips }),

  setSearchResults: (searchResults) => set({ searchResults }),

  selectChip: (chip) => set({ selectedChip: chip }),

  setChipInfo: (chipInfo) =>
    set({
      chipInfo,
      memoryRegions: chipInfo?.memory_regions || [],
      flashAlgorithms: chipInfo?.flash_algorithms || [],
    }),

  setMemoryRegions: (memoryRegions) => set({ memoryRegions }),

  setFlashAlgorithms: (flashAlgorithms) => set({ flashAlgorithms }),

  setLoading: (loading) => set({ loading }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  addRecentChip: (chip) =>
    set((state) => {
      const recentChips = [chip, ...state.recentChips.filter((c) => c !== chip)].slice(0, RECENT_CHIPS_LIMIT);
      saveToStorage(RECENT_CHIPS_KEY, recentChips);
      return { recentChips };
    }),

  reset: () =>
    set({
      searchResults: [],
      selectedChip: null,
      chipInfo: null,
      memoryRegions: [],
      flashAlgorithms: [],
      searchQuery: "",
    }),
}));
