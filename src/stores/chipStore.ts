import { create } from "zustand";
import type { ChipInfo, MemoryRegionInfo, FlashAlgorithmInfo } from "@/lib/types";

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

  // 操作
  setChips: (chips: string[]) => void;
  setSearchResults: (results: string[]) => void;
  selectChip: (chip: string | null) => void;
  setChipInfo: (info: ChipInfo | null) => void;
  setMemoryRegions: (regions: MemoryRegionInfo[]) => void;
  setFlashAlgorithms: (algorithms: FlashAlgorithmInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
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
