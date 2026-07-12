import { useEditorStore } from "@/stores/editor-store";
export type { OpenFile, Tab, SessionTab } from "@/stores/editor-store";
import { applyLineJump } from "@/components/editor-area/editor-line-jump";
import { getEditorView } from "@/lib/editor-view-registry";
import { setPendingLineJump } from "@/lib/pending-line-jump";

export function getOpenFile(path: string) {
  return useEditorStore.getState().openFiles.get(path) ?? null;
}

export function getOpenFiles() {
  return useEditorStore.getState().openFiles;
}

export function getActiveFilePath() {
  return useEditorStore.getState().activeFilePath;
}

export function closeFile(path: string) {
  useEditorStore.getState().closeFile(path);
}

export function closeActiveTab() {
  useEditorStore.getState().closeActiveTab();
}

export function markSaved(path: string, diskContent: string) {
  useEditorStore.getState().markSaved(path, diskContent);
}

export function updateContent(path: string, content: string) {
  useEditorStore.getState().updateContent(path, content);
}

export function updateCursorPos(path: string, pos: number) {
  useEditorStore.getState().updateCursorPos(path, pos);
}

export function updateScrollPos(path: string, pos: number) {
  useEditorStore.getState().updateScrollPos(path, pos);
}

export function updateFrontmatter(path: string, frontmatter: string | null) {
  useEditorStore.getState().updateFrontmatter(path, frontmatter);
}

export function reloadFromDisk(path: string, rawContent: string) {
  useEditorStore.getState().reloadFromDisk(path, rawContent);
}

export function navigateToFile(path: string) {
  return useEditorStore.getState().navigateToFile(path);
}

export function renameOpenFile(oldPath: string, newPath: string) {
  useEditorStore.getState().renameOpenFile(oldPath, newPath);
}

export function openFileInNewTab(path: string) {
  return useEditorStore.getState().openFileInNewTab(path);
}

export function removePathReferences(path: string) {
  useEditorStore.getState().removePathReferences(path);
}

export function removePathsWithPrefix(prefix: string) {
  useEditorStore.getState().removePathsWithPrefix(prefix);
}

export function rewritePathPrefix(oldPrefix: string, newPrefix: string) {
  useEditorStore.getState().rewritePathPrefix(oldPrefix, newPrefix);
}

// Jump to a line + highlighted char ranges in a file. If the file is already
// open, highlight + scroll its live editor view directly; otherwise stash a
// pending jump and navigate so the editor consumes it on swap.
export function jumpToLine(path: string, lineNumber: number, ranges: [number, number][]) {
  const view = getEditorView(path);
  if (view) {
    applyLineJump(view, lineNumber, ranges);
  } else {
    setPendingLineJump(path, { line: lineNumber, ranges });
    void navigateToFile(path);
  }
}
