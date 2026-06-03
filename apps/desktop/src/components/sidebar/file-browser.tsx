import { useCallback, useState, type MouseEvent } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useWorkspace } from "@/hooks/use-workspace";
import { useOpenCommandPalette } from "@/hooks/use-command-palette";
import { useSetting } from "@/hooks/use-settings";
import {
  usePinnedFiles,
  useRefreshDirectory,
  useRemovePinnedFile,
  useRewritePinnedPath,
  useTogglePinnedFile,
} from "@/hooks/use-file-tree";
import { useOpenFile } from "@/hooks/use-tabs";
import {
  getOpenFile,
  openFileInNewTab as openFileInNewTabAction,
  removePathReferences,
  renameOpenFile,
} from "@/hooks/editor-api";
import {
  SIDEBAR_SECTION_PAGE_SIZE,
  RECENTS_SECTION_PAGE_SIZE,
  usePinnedSidebarFiles,
  useRecentSidebarFiles,
} from "@/hooks/use-sidebar-files";
import * as tauri from "@/lib/tauri";
import { getFileStem, getParentDir, getRelativePath } from "@/lib/paths";
import { FileTree } from "./file-tree";
import { ScrollFade } from "@/components/scroll-fade";
import { duplicateFile } from "./duplicate-file";
import { showFileContextMenu } from "./file-context-menu";
import { FileTreeNode } from "./file-tree-node";
import { ShowMoreButton, SidebarSection } from "./sidebar-section";
import type { DirEntry } from "@/types/fs";

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot);
}

export function FileBrowser() {
  const { root } = useWorkspace();
  const openCommandPalette = useOpenCommandPalette();
  const openFile = useOpenFile();
  const refreshDirectory = useRefreshDirectory();
  const fileLabelMode = useSetting("appearance.sidebar-file-label");
  const pinnedPaths = usePinnedFiles();
  const togglePinnedFile = useTogglePinnedFile();
  const removePinnedFile = useRemovePinnedFile();
  const rewritePinnedPath = useRewritePinnedPath();
  const [recentVisibleCount, setRecentVisibleCount] = useState(RECENTS_SECTION_PAGE_SIZE);
  const [pinnedVisibleCount, setPinnedVisibleCount] = useState(SIDEBAR_SECTION_PAGE_SIZE);
  const recentFiles = useRecentSidebarFiles(recentVisibleCount);
  const pinnedEntries = usePinnedSidebarFiles(pinnedVisibleCount);

  const noopToggleDirectory = useCallback(async () => {}, []);

  const handleRenameFile = useCallback(
    (entry: DirEntry) => {
      void (async () => {
        const currentStem = getFileStem(entry.name);
        const nextValue = window.prompt("Rename file", currentStem);
        const trimmed = nextValue?.trim();
        if (!trimmed || trimmed === currentStem) return;

        const ext = getExtension(entry.name);
        const parent = getParentDir(entry.path);
        const newPath = `${parent}/${trimmed}${ext}`;
        if (newPath === entry.path) return;

        try {
          if (await tauri.fileExists(newPath)) {
            window.alert(`A file named "${trimmed}${ext}" already exists.`);
            return;
          }
          await tauri.renameEntry(entry.path, newPath);
          renameOpenFile(entry.path, newPath);
          rewritePinnedPath(entry.path, newPath);
          await refreshDirectory(parent);
        } catch (error) {
          window.alert(
            `Failed to rename: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    },
    [refreshDirectory, rewritePinnedPath],
  );

  const handleFileContextMenu = useCallback(
    (_event: MouseEvent<HTMLElement>, entry: DirEntry) => {
      if (!root) return;
      const parent = getParentDir(entry.path);
      const relative = getRelativePath(entry.path, root);

      void showFileContextMenu({
        isPinned: pinnedPaths.includes(entry.path),
        onOpen: () => {
          void openFile(entry.path);
        },
        onOpenInNewTab: () => {
          void openFileInNewTabAction(entry.path).catch((error: unknown) => {
            window.alert(
              `Failed to open in new tab: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
        onTogglePin: () => {
          togglePinnedFile(entry.path);
        },
        onDuplicate: () => {
          void (async () => {
            try {
              const newPath = await duplicateFile(entry.path);
              await refreshDirectory(parent);
              await openFileInNewTabAction(newPath);
            } catch (error) {
              window.alert(
                `Failed to duplicate: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          })();
        },
        onCopyRelativePath: () => {
          void writeText(relative);
        },
        onCopyAbsolutePath: () => {
          void writeText(entry.path);
        },
        onReveal: () => {
          void tauri.revealInFileManager(entry.path).catch((error: unknown) => {
            window.alert(
              `Failed to reveal: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
        onRename: () => {
          handleRenameFile(entry);
        },
        onDelete: () => {
          void (async () => {
            const openFileState = getOpenFile(entry.path);
            if (openFileState?.isDirty) {
              const confirmed = window.confirm(
                `"${entry.name}" has unsaved changes. Delete anyway?`,
              );
              if (!confirmed) return;
            }
            try {
              await tauri.deleteEntry(entry.path);
              removePathReferences(entry.path);
              removePinnedFile(entry.path);
              await refreshDirectory(parent);
            } catch (error) {
              window.alert(
                `Failed to delete: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          })();
        },
      });
    },
    [
      handleRenameFile,
      openFile,
      pinnedPaths,
      refreshDirectory,
      removePinnedFile,
      root,
      togglePinnedFile,
    ],
  );

  if (!root) {
    return <div className="p-4 text-[13px] text-[var(--text-muted)]">No folder open</div>;
  }

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
      </div>

      <ScrollFade className="min-h-0 flex-1 overflow-y-scroll scrollbar-none">
        <div className="flex flex-col gap-4 py-2">
          {pinnedEntries.files.length > 0 && (
            <SidebarSection title="Pinned">
              <div role="tree" aria-label="Pinned files" className="flex flex-col gap-px">
                {pinnedEntries.files.map((entry) => (
                  <FileTreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    isExpanded={false}
                    isRenaming={false}
                    isSelected={false}
                    onToggleDir={noopToggleDirectory}
                    onOpenFile={openFile}
                    onContextMenu={handleFileContextMenu}
                    fileLabelMode={fileLabelMode}
                  />
                ))}
                {pinnedEntries.hasMore && (
                  <ShowMoreButton
                    onClick={() =>
                      setPinnedVisibleCount((count) => count + SIDEBAR_SECTION_PAGE_SIZE)
                    }
                  />
                )}
              </div>
            </SidebarSection>
          )}

          {recentFiles.files.length > 0 && (
            <SidebarSection title="Recents">
              <div role="tree" aria-label="Recents" className="flex flex-col gap-px">
                {recentFiles.files.map((entry) => (
                  <FileTreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    isExpanded={false}
                    isRenaming={false}
                    isSelected={false}
                    onToggleDir={noopToggleDirectory}
                    onOpenFile={openFile}
                    onContextMenu={handleFileContextMenu}
                    fileLabelMode={fileLabelMode}
                  />
                ))}
                {recentFiles.hasMore && (
                  <ShowMoreButton
                    onClick={() =>
                      setRecentVisibleCount((count) => count + RECENTS_SECTION_PAGE_SIZE)
                    }
                  />
                )}
              </div>
            </SidebarSection>
          )}

          <SidebarSection title="Everything">
            <FileTree rootPath={root} />
          </SidebarSection>
        </div>
      </ScrollFade>
    </div>
  );
}
