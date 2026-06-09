import { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { File02Icon, FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { useActiveFilePath } from "@/hooks/use-tabs";
import { getFileStem } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import type { DirEntry } from "@/types/fs";

interface CompactRecentsListProps {
  openFile: (path: string) => Promise<void>;
  onOpenFileComplete?: () => void;
  className?: string;
}

/** Picker content for standalone compact windows: the global recents list
 *  plus an "Open other file…" escape hatch. No workspace data involved. */
export function CompactRecentsList({
  openFile,
  onOpenFileComplete,
  className,
}: CompactRecentsListProps) {
  const recentFiles = useGlobalRecentFiles();
  const activeFilePath = useActiveFilePath();

  const openFileAndComplete = useCallback(
    async (path: string) => {
      await openFile(path);
      onOpenFileComplete?.();
    },
    [onOpenFileComplete, openFile],
  );

  const handlePickFile = useCallback(() => {
    void (async () => {
      const picked = await tauri.pickFile();
      if (picked) await openFileAndComplete(picked);
    })();
  }, [openFileAndComplete]);

  return (
    <div className={className}>
      {recentFiles.length > 0 && (
        <div role="list" aria-label="Recent files" className="flex flex-col gap-px">
          {recentFiles.map((entry) => (
            <RecentFileRow
              key={entry.path}
              entry={entry}
              isActive={entry.path === activeFilePath}
              onOpen={openFileAndComplete}
            />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={handlePickFile}
        className="group flex h-[32px] w-full items-center gap-1.5 rounded-lg pl-[10px] pr-2 text-left text-[13px] leading-[1.15] text-[var(--fg-base)] hover:bg-[var(--surface-subtle)]"
      >
        <span className="flex w-5 shrink-0 items-center justify-center opacity-60 group-hover:opacity-100">
          <HugeiconsIcon
            icon={FolderLibraryIcon}
            size={16}
            color="currentColor"
            strokeWidth={1.8}
          />
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap opacity-60 group-hover:opacity-100">
          Open other file…
        </span>
      </button>
    </div>
  );
}

interface RecentFileRowProps {
  entry: DirEntry;
  isActive: boolean;
  onOpen: (path: string) => Promise<void>;
}

function RecentFileRow({ entry, isActive, onOpen }: RecentFileRowProps) {
  const label = entry.title || getFileStem(entry.name);

  return (
    <button
      type="button"
      role="listitem"
      onClick={() => void onOpen(entry.path)}
      className={`flex h-[32px] w-full items-center gap-1.5 overflow-hidden rounded-lg pl-[10px] pr-2 text-left text-[13px] leading-[1.15] text-[var(--fg-base)] ${
        isActive ? "bg-[var(--surface-subtle)]" : "hover:bg-[var(--surface-subtle)]"
      }`}
    >
      <span
        className="flex w-5 shrink-0 items-center justify-center antialiased text-current"
        aria-hidden="true"
      >
        <HugeiconsIcon icon={File02Icon} size={16} color="currentColor" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
    </button>
  );
}
