import { useOpenFile } from "@/hooks/use-tabs";
import { useOpenCommandPalette } from "@/hooks/use-command-palette";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { formatRelativeTime } from "@/lib/relative-time";
import { getFileName, getParentDir } from "@/lib/paths";

function Shortcut({ children }: { children: string }) {
  return (
    <kbd className="text-[11px] tracking-[0.2em] text-[var(--text-icon-muted)]">{children}</kbd>
  );
}

export function NewTabPage() {
  const openFile = useOpenFile();
  const openCommandPalette = useOpenCommandPalette();
  const { files: recentFiles } = useGlobalRecentFiles(10);

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => openCommandPalette("create-file")}
            className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Create new note
            <Shortcut>⌘N</Shortcut>
          </button>

          <button
            type="button"
            onClick={() => openCommandPalette("search")}
            className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Search
            <Shortcut>⌘O</Shortcut>
          </button>
        </div>

        {recentFiles.length > 0 && (
          <div className="w-full max-w-[320px]">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
              Recents
            </div>
            <div className="flex flex-col gap-0.5">
              {recentFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => openFile(file.path)}
                  className="group flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[var(--text-primary)]">
                      {file.title ?? getFileName(file.path)}
                    </span>
                    <span className="truncate text-[var(--text-muted)]">
                      {getParentDir(file.path)}
                    </span>
                  </div>
                  <span className="shrink-0 text-[var(--text-muted)]">
                    {formatRelativeTime(file.opened_at)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
