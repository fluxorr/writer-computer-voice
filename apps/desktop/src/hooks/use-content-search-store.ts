import { useUIStore } from "@/stores/ui-store";

export function useIsContentSearchOpen() {
  return useUIStore((s) => s.isContentSearchOpen);
}

export function useOpenContentSearch() {
  return useUIStore((s) => s.openContentSearch);
}

export function useCloseContentSearch() {
  return useUIStore((s) => s.closeContentSearch);
}
