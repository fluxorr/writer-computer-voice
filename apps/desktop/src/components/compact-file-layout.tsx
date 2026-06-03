import { useCallback, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { LayoutGroup, motion } from "motion/react";
import { EditorArea } from "./editor-area";
import { SidebarNavigator } from "./sidebar/sidebar-navigator";
import { ScrollFade } from "@/components/scroll-fade";
import { useActiveFilePath, useOpenCompactFile, useOpenFiles } from "@/hooks/use-tabs";
import { getFileName } from "@/lib/paths";

const PICKER_SURFACE_LAYOUT_ID = "compact-file-picker-surface";
const pickerTransition = { duration: 0.2, ease: "circOut" } as const;

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
        <LayoutGroup>
          <Popover.Root open={isNavigatorOpen} onOpenChange={(open) => setIsNavigatorOpen(open)}>
            <Popover.Trigger
              aria-label="Open file navigator"
              className="group relative inline-flex h-[var(--chrome-control-height)] max-w-[min(240px,calc(100vw-40px))] items-center justify-center gap-1.5 rounded-lg border border-transparent bg-transparent px-3 text-[13px] text-[var(--fg-base)]"
            >
              {!isNavigatorOpen && (
                <motion.div
                  layoutId={PICKER_SURFACE_LAYOUT_ID}
                  transition={pickerTransition}
                  className="absolute inset-0 rounded-lg bg-transparent transition-colors group-hover:bg-[var(--surface-input)]"
                />
              )}
              <span className="relative min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {title}
              </span>
              <span
                aria-hidden="true"
                className={`relative shrink-0 text-[var(--text-icon-muted)] transition-transform duration-150 ease-out ${
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
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Positioner side="bottom" align="center" sideOffset={8} className="z-50">
                <Popover.Popup
                  initialFocus={false}
                  finalFocus={false}
                  render={
                    <motion.div layoutId={PICKER_SURFACE_LAYOUT_ID} transition={pickerTransition} />
                  }
                  className="surface-card relative w-[min(360px,calc(100vw-40px))] overflow-hidden rounded-xl outline-none"
                >
                  <motion.div layout="size" transition={pickerTransition}>
                    <ScrollFade className="max-h-[min(70vh,560px)] overflow-y-auto px-2 py-3 scrollbar-none">
                      <SidebarNavigator
                        openFile={handleOpenFile}
                        enableContextMenus={false}
                        onOpenFileComplete={() => setIsNavigatorOpen(false)}
                        className="flex flex-col gap-4"
                      />
                    </ScrollFade>
                  </motion.div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </LayoutGroup>
      </div>

      <div className="relative h-full min-w-0 bg-bg">
        <EditorArea />
      </div>
    </div>
  );
}
