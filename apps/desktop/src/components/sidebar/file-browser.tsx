import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useOpenCommandPalette } from "@/hooks/use-command-palette";
import { useOpenContentSearch } from "@/hooks/use-content-search-store";
import { useWorkspace } from "@/hooks/use-workspace";
import { ScrollFade } from "@/components/scroll-fade";
import { SidebarNavigator } from "./sidebar-navigator";

export function FileBrowser() {
  const openCommandPalette = useOpenCommandPalette();
  const openContentSearch = useOpenContentSearch();
  const { root } = useWorkspace();

  return (
    <div className="flex h-full min-h-0 flex-col px-3">
      <div
        className="flex items-center"
        style={{
          height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
          padding: "var(--chrome-control-padding) 0",
        }}
      >
        <button
          type="button"
          onClick={() => openCommandPalette()}
          className="relative flex w-full items-center rounded-lg border border-transparent bg-[var(--surface-input)] pl-[34px] pr-3 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--fg-base)] h-[var(--chrome-control-height)]"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-current"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </span>
          Search
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-current">
            ⌘<span className="ml-0.5">P</span>
          </kbd>
        </button>
        {root && (
          <button
            type="button"
            onClick={() => openContentSearch()}
            title="Search in files (⌘⇧F)"
            aria-label="Search in files"
            className="ml-2 flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-[var(--surface-input)] text-[var(--text-muted)] transition-colors hover:text-[var(--fg-base)] h-[var(--chrome-control-height)] w-[var(--chrome-control-height)]"
          >
            <HugeiconsIcon icon={Search01Icon} size={16} color="currentColor" strokeWidth={2} />
          </button>
        )}
      </div>

      <ScrollFade className="min-h-0 flex-1 overflow-y-scroll scrollbar-none">
        <SidebarNavigator />
      </ScrollFade>
    </div>
  );
}
