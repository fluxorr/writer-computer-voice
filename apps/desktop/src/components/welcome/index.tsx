import { useWorkspace } from "@/hooks/use-workspace";
import * as tauri from "@/lib/tauri";
import { getParentDir } from "@/lib/paths";

function RecentWorkspace({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-subtle)]"
    >
      <span className="truncate">{name}</span>
      <span className="shrink-0 truncate text-[var(--text-muted)] opacity-60">{path}</span>
    </button>
  );
}

export function WelcomeScreen() {
  const { openWorkspace, recentWorkspaces } = useWorkspace();

  async function handleAddLocation() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      await openWorkspace(picked);
    }
  }

  async function handleOpenFile() {
    const picked = await tauri.pickFile();
    if (!picked) return;
    const dir = getParentDir(picked);
    await openWorkspace(dir);
    await import("@/stores/editor-store").then((m) => m.useEditorStore.getState().openFile(picked));
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg text-text-primary">
      <div className="flex w-full max-w-[360px] flex-col items-center px-6">
        <p className="mb-6 text-center text-[13px] leading-relaxed text-text-muted">
          Add a folder with your specs, docs, notes, or any markdown files.
        </p>

        <div className="mb-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void handleAddLocation()}
            className="flex items-center gap-2 rounded-lg bg-[var(--text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--surface-primary)] transition-opacity hover:opacity-90"
          >
            Add Folder
          </button>
          <button
            type="button"
            onClick={() => void handleOpenFile()}
            className="flex items-center gap-2 rounded-lg border border-[var(--line-subtle)] px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            Open File
          </button>
        </div>

        {recentWorkspaces.length > 0 && (
          <div className="w-full">
            <p className="mb-2 text-[11px] font-medium tracking-wider text-[var(--text-muted)] uppercase">
              Recent folders
            </p>
            <div className="flex flex-col">
              {recentWorkspaces.map((path) => (
                <RecentWorkspace key={path} path={path} onOpen={openWorkspace} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
