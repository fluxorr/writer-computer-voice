import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { EditorArea } from "./editor-area";
import { SidebarNavigator } from "./sidebar/sidebar-navigator";
import { ScrollFade } from "@/components/scroll-fade";
import { useActiveFilePath, useOpenCompactFile, useOpenFiles } from "@/hooks/use-tabs";
import { getFileName } from "@/lib/paths";

const PICKER_POPUP_ID = "compact-file-picker-popup";
const PICKER_ANIMATION_MS = 200;
const PICKER_GAP = "8px";
const PICKER_OPEN_HEIGHT = "min(560px, calc(100vh - 96px))";
const PICKER_SHELL_HEIGHT = `calc(var(--chrome-control-height) + ${PICKER_GAP} + ${PICKER_OPEN_HEIGHT})`;
const PICKER_OPEN_CLIP_PATH = `inset(calc(var(--chrome-control-height) + ${PICKER_GAP}) 0 0 0 round 12px)`;

export function CompactFileLayout() {
  const activeFilePath = useActiveFilePath();
  const openFiles = useOpenFiles();
  const openCompactFile = useOpenCompactFile();
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
  const [isPickerMounted, setIsPickerMounted] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState(120);
  const pickerRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openFrameRef = useRef<number | null>(null);
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const title = activeFilePath ? activeFile?.title || getFileName(activeFilePath) : "Choose file";

  const handleOpenFile = useCallback(
    async (path: string) => {
      await openCompactFile(path);
    },
    [openCompactFile],
  );

  const openNavigator = useCallback(() => {
    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
    }
    setTriggerWidth(Math.ceil(triggerRef.current?.getBoundingClientRect().width ?? 120));
    setIsPickerMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = null;
      setIsNavigatorOpen(true);
    });
  }, []);

  const closeNavigator = useCallback(() => {
    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
    setIsNavigatorOpen(false);
  }, []);

  useEffect(() => {
    if (!isNavigatorOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && pickerRootRef.current?.contains(target)) return;
      closeNavigator();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeNavigator();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeNavigator, isNavigatorOpen]);

  useEffect(() => {
    if (isNavigatorOpen || !isPickerMounted) return;
    const timeout = window.setTimeout(() => {
      setIsPickerMounted(false);
    }, PICKER_ANIMATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isNavigatorOpen, isPickerMounted]);

  useEffect(() => {
    return () => {
      if (openFrameRef.current) {
        window.cancelAnimationFrame(openFrameRef.current);
      }
    };
  }, []);

  const pickerClipPath = isNavigatorOpen
    ? PICKER_OPEN_CLIP_PATH
    : `inset(0 calc((100% - ${triggerWidth}px) / 2) calc(100% - var(--chrome-control-height)) calc((100% - ${triggerWidth}px) / 2) round 8px)`;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent text-text-primary">
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-30"
        style={{ height: "var(--chrome-drag-height)" }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center"
        style={{
          height: "calc(var(--chrome-control-height) + var(--chrome-control-padding) * 2)",
          paddingBlock: "var(--chrome-control-padding)",
        }}
      >
        <div
          ref={pickerRootRef}
          className="pointer-events-auto relative flex w-[min(360px,calc(100vw-40px))] justify-center"
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label="Open file navigator"
            aria-haspopup="dialog"
            aria-controls={isNavigatorOpen ? PICKER_POPUP_ID : undefined}
            aria-expanded={isNavigatorOpen}
            onClick={isNavigatorOpen ? closeNavigator : openNavigator}
            className="group relative inline-flex h-[var(--chrome-control-height)] max-w-[240px] items-center justify-center gap-1.5 rounded-lg border border-transparent bg-transparent px-3 font-[inherit] text-[13px] text-[var(--fg-base)]"
          >
            {!isPickerMounted && (
              <div className="pointer-events-none absolute inset-0 rounded-lg bg-transparent transition-colors group-hover:bg-[var(--surface-input)]" />
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
          </button>

          {isPickerMounted && (
            <div
              aria-hidden="true"
              className="surface-card pointer-events-none absolute left-0 top-0 z-40 w-full overflow-hidden rounded-xl transition-[clip-path] duration-200 ease-out"
              style={{
                height: PICKER_SHELL_HEIGHT,
                clipPath: pickerClipPath,
              }}
            />
          )}

          {isPickerMounted && (
            <div
              id={PICKER_POPUP_ID}
              role="dialog"
              aria-label="File navigator"
              className="absolute left-0 z-50 w-full rounded-xl outline-none"
              style={{
                top: `calc(var(--chrome-control-height) + ${PICKER_GAP})`,
                height: PICKER_OPEN_HEIGHT,
                pointerEvents: isNavigatorOpen ? "auto" : "none",
              }}
            >
              <div
                className={`relative h-full overflow-hidden rounded-xl transition-opacity duration-100 ease-out ${
                  isNavigatorOpen ? "opacity-100 delay-100" : "opacity-0"
                }`}
              >
                <ScrollFade className="h-full overflow-y-auto px-2 py-3 scrollbar-none">
                  <SidebarNavigator
                    openFile={handleOpenFile}
                    enableContextMenus={false}
                    onOpenFileComplete={closeNavigator}
                    className="flex flex-col gap-4"
                  />
                </ScrollFade>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative h-full min-w-0 bg-bg">
        <EditorArea />
      </div>
    </div>
  );
}
