import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { EditorArea } from "./editor-area";
import { SidebarNavigator } from "./sidebar/sidebar-navigator";
import { ScrollFade } from "@/components/scroll-fade";
import { useActiveFilePath, useOpenCompactFile, useOpenFiles } from "@/hooks/use-tabs";
import { getFileName } from "@/lib/paths";

const PICKER_POPUP_ID = "compact-file-picker-popup";
const PICKER_ANIMATION_MS = 240;
const PICKER_GAP_PX = 8;
const PICKER_MAX_OPEN_HEIGHT = 560;
const PICKER_VIEWPORT_HEIGHT_OFFSET = 96;
const PICKER_CLOSED_RADIUS = 8;
const PICKER_OPEN_RADIUS = 12;
const FALLBACK_PICKER_METRICS = {
  triggerWidth: 120,
  triggerHeight: 32,
  rootWidth: 360,
  openHeight: 560,
};

export function CompactFileLayout() {
  const activeFilePath = useActiveFilePath();
  const openFiles = useOpenFiles();
  const openCompactFile = useOpenCompactFile();
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
  const [isPickerMounted, setIsPickerMounted] = useState(false);
  const [pickerMetrics, setPickerMetrics] = useState(FALLBACK_PICKER_METRICS);
  const pickerRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openFrameRef = useRef<number | null>(null);
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
  const title = activeFilePath ? activeFile?.title || getFileName(activeFilePath) : "Choose file";

  const measurePickerMetrics = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const rootRect = pickerRootRef.current?.getBoundingClientRect();
    const nextMetrics = {
      triggerWidth: Math.ceil(triggerRect?.width ?? FALLBACK_PICKER_METRICS.triggerWidth),
      triggerHeight: Math.ceil(triggerRect?.height ?? FALLBACK_PICKER_METRICS.triggerHeight),
      rootWidth: Math.ceil(rootRect?.width ?? FALLBACK_PICKER_METRICS.rootWidth),
      openHeight: Math.max(
        FALLBACK_PICKER_METRICS.triggerHeight,
        Math.min(PICKER_MAX_OPEN_HEIGHT, window.innerHeight - PICKER_VIEWPORT_HEIGHT_OFFSET),
      ),
    };
    setPickerMetrics((currentMetrics) => {
      if (
        currentMetrics.triggerWidth === nextMetrics.triggerWidth &&
        currentMetrics.triggerHeight === nextMetrics.triggerHeight &&
        currentMetrics.rootWidth === nextMetrics.rootWidth &&
        currentMetrics.openHeight === nextMetrics.openHeight
      ) {
        return currentMetrics;
      }
      return nextMetrics;
    });
  }, []);

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
    measurePickerMetrics();
    setIsPickerMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = null;
      setIsNavigatorOpen(true);
    });
  }, [measurePickerMetrics]);

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

  useLayoutEffect(() => {
    measurePickerMetrics();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measurePickerMetrics);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    if (pickerRootRef.current) resizeObserver?.observe(pickerRootRef.current);
    window.addEventListener("resize", measurePickerMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measurePickerMetrics);
    };
  }, [measurePickerMetrics]);

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

  const pickerOpenTop = pickerMetrics.triggerHeight + PICKER_GAP_PX;
  const pickerShellHeight = pickerOpenTop + pickerMetrics.openHeight;
  const pickerMaskLeft = isNavigatorOpen
    ? 0
    : Math.max(0, (pickerMetrics.rootWidth - pickerMetrics.triggerWidth) / 2);
  const pickerMaskTop = isNavigatorOpen ? pickerOpenTop : 0;
  const pickerMaskWidth = isNavigatorOpen ? pickerMetrics.rootWidth : pickerMetrics.triggerWidth;
  const pickerMaskHeight = isNavigatorOpen ? pickerMetrics.openHeight : pickerMetrics.triggerHeight;
  const pickerMaskRadius = isNavigatorOpen ? PICKER_OPEN_RADIUS : PICKER_CLOSED_RADIUS;
  const pickerMaskRight = Math.max(0, pickerMetrics.rootWidth - pickerMaskLeft - pickerMaskWidth);
  const pickerMaskBottom = Math.max(0, pickerShellHeight - pickerMaskTop - pickerMaskHeight);
  const pickerMaskClipPath = `inset(${pickerMaskTop}px ${pickerMaskRight}px ${pickerMaskBottom}px ${pickerMaskLeft}px round ${pickerMaskRadius}px)`;
  const pickerShellStyle = {
    width: `${pickerMetrics.rootWidth}px`,
    height: `${pickerShellHeight}px`,
    "--compact-picker-card-clip-path": pickerMaskClipPath,
    "--compact-picker-shadow-filter": isNavigatorOpen
      ? "drop-shadow(0 15px 35px rgba(0, 0, 0, 0.15))"
      : "drop-shadow(0 0 0 rgba(0, 0, 0, 0))",
  } as CSSProperties;
  const pickerNavigatorStyle = {
    position: "absolute",
    left: 0,
    top: `${pickerOpenTop}px`,
    width: `${pickerMetrics.rootWidth}px`,
    height: `${pickerMetrics.openHeight}px`,
  } as CSSProperties;
  const pickerBorderStyle = {
    "--compact-picker-border-x": `${pickerMaskLeft}px`,
    "--compact-picker-border-y": `${pickerMaskTop}px`,
    "--compact-picker-border-width": `${pickerMaskWidth}px`,
    "--compact-picker-border-height": `${pickerMaskHeight}px`,
    "--compact-picker-border-radius": `${pickerMaskRadius}px`,
  } as CSSProperties;

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
          className="group pointer-events-auto relative isolate flex w-[min(360px,calc(100vw-40px))] justify-center"
        >
          <div
            id={isPickerMounted ? PICKER_POPUP_ID : undefined}
            role={isPickerMounted ? "dialog" : undefined}
            aria-label={isPickerMounted ? "File navigator" : undefined}
            className={`compact-picker-shell absolute left-0 top-0 z-0 ${
              isPickerMounted ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            style={{
              ...pickerShellStyle,
              pointerEvents: isNavigatorOpen ? "auto" : "none",
            }}
          >
            <div aria-hidden="true" className="compact-picker-card-surface absolute inset-0" />
            {isPickerMounted && (
              <div
                className={`compact-picker-card-mask absolute inset-0 z-10 transition-opacity duration-100 ease-out ${
                  isNavigatorOpen ? "opacity-100" : "opacity-0"
                }`}
              >
                <div style={pickerNavigatorStyle}>
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
            <svg
              aria-hidden="true"
              className="compact-picker-border-layer"
              width={pickerMetrics.rootWidth}
              height={pickerShellHeight}
              viewBox={`0 0 ${pickerMetrics.rootWidth} ${pickerShellHeight}`}
            >
              <rect
                className="compact-picker-border-rect"
                x={pickerMaskLeft}
                y={pickerMaskTop}
                width={pickerMaskWidth}
                height={pickerMaskHeight}
                rx={pickerMaskRadius}
                ry={pickerMaskRadius}
                style={pickerBorderStyle}
              />
            </svg>
          </div>

          <button
            ref={triggerRef}
            type="button"
            aria-label="Open file navigator"
            aria-haspopup="dialog"
            aria-controls={isNavigatorOpen ? PICKER_POPUP_ID : undefined}
            aria-expanded={isNavigatorOpen}
            onClick={isNavigatorOpen ? closeNavigator : openNavigator}
            className="relative z-30 inline-flex h-[var(--chrome-control-height)] max-w-[240px] items-center justify-center gap-1.5 rounded-lg border border-transparent bg-transparent px-3 font-[inherit] text-[13px] text-[var(--fg-base)]"
          >
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
        </div>
      </div>

      <div className="relative h-full min-w-0 bg-bg">
        <EditorArea />
      </div>
    </div>
  );
}
