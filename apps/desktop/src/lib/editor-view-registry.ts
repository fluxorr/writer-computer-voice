// Registry of live CodeMirror views keyed by absolute file path, so features
// like content-search line-jump can target the editor for an already-open
// file without going through an async swap.

import type { EditorView } from "@codemirror/view";

const views = new Map<string, EditorView>();

export function registerEditorView(path: string, view: EditorView): void {
  views.set(path, view);
}

export function unregisterEditorView(path: string, view: EditorView): void {
  if (views.get(path) === view) views.delete(path);
}

export function getEditorView(path: string): EditorView | null {
  return views.get(path) ?? null;
}
