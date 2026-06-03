import { useCallback, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { EditorArea } from "./editor-area";
import { SidebarNavigator } from "./sidebar/sidebar-navigator";
import { ScrollFade } from "@/components/scroll-fade";
import { SurfaceCard } from "@/components/surface-card";
import { useActiveFilePath, useOpenCompactFile, useOpenFiles } from "@/hooks/use-tabs";
import { getFileName } from "@/lib/paths";

export function CompactFileLayout() {
  const activeFilePath = useActiveFilePath();
  const openFiles = useOpenFiles();
  const openCompactFile = useOpenCompactFile();
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const title = activeFilePath ? activeFile?.title || getFileName(activeFilePath) : "Choose file";

  const handleOpenFile = useCallback(
    async (path: string) => {
      await openCompactFile(path);
    },
    [openCompactFile],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent text-text-primary">
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-30"
        style={{ height: "var(--chrome-drag-height)" }}
      />
      <div
        className="pointer-events-auto absolute left-1/2 top-0 z-50 flex -translate-x-1/2 items-center"
        style={{
          height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
          paddingBlock: "var(--chrome-control-padding)",
        }}
      >
        <div className="relative w-[min(240px,calc(100vw-40px))]">
          <button
            type="button"
            aria-haspopup="tree"
            aria-expanded={isNavigatorOpen}
            aria-label="Open file navigator"
            onClick={() => setIsNavigatorOpen((open) => !open)}
            className="relative flex h-[var(--chrome-control-height)] w-full items-center justify-center rounded-lg border border-transparent bg-[var(--surface-input)] px-9 text-center text-[13px] text-[var(--fg-base)] transition-colors hover:bg-[var(--surface-subtle-strong)]"
          >
            <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
              {title}
            </span>
            <span
              aria-hidden="true"
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-icon-muted)] transition-transform duration-150 ease-out ${
                isNavigatorOpen ? "rotate-180" : ""
              }`}
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={16}
                color="currentColor"
                strokeWidth={2}
              />
            </span>
          </button>

          {isNavigatorOpen && (
            <SurfaceCard className="absolute left-1/2 top-[calc(100%+8px)] w-[min(360px,calc(100vw-40px))] -translate-x-1/2 overflow-hidden rounded-xl">
              <ScrollFade className="max-h-[min(70vh,560px)] overflow-y-auto px-2 py-3 scrollbar-none">
                <SidebarNavigator
                  openFile={handleOpenFile}
                  enableContextMenus={false}
                  onOpenFileComplete={() => setIsNavigatorOpen(false)}
                  className="flex flex-col gap-4"
                />
              </ScrollFade>
            </SurfaceCard>
          )}
        </div>
      </div>

      <div className="relative h-full min-w-0 bg-bg">
        <EditorArea />
      </div>
    </div>
  );
}
