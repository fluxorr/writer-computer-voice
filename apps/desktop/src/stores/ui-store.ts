import { create } from "zustand";

export type CommandPaletteIntent = "search" | "create-file";

interface UIState {
  isCommandPaletteOpen: boolean;
  commandPaletteIntent: CommandPaletteIntent;
  commandPaletteSearch: string;

  isContentSearchOpen: boolean;

  openCommandPalette: (intent?: CommandPaletteIntent) => void;
  closeCommandPalette: () => void;
  setCommandPaletteSearch: (search: string) => void;

  openContentSearch: () => void;
  closeContentSearch: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isCommandPaletteOpen: false,
  commandPaletteIntent: "search",
  commandPaletteSearch: "",

  isContentSearchOpen: false,

  openCommandPalette: (intent = "search") =>
    set({ isCommandPaletteOpen: true, commandPaletteIntent: intent, commandPaletteSearch: "" }),
  closeCommandPalette: () =>
    set({
      isCommandPaletteOpen: false,
      commandPaletteIntent: "search",
      commandPaletteSearch: "",
    }),
  setCommandPaletteSearch: (search: string) => set({ commandPaletteSearch: search }),

  openContentSearch: () => set({ isContentSearchOpen: true, isCommandPaletteOpen: false }),
  closeContentSearch: () => set({ isContentSearchOpen: false }),
}));
