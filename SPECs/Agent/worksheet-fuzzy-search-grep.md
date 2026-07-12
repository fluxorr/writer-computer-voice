# Worksheet: Fuzzy Content Search & Grep

## Task

TODOS.md → backlog "Fuzzy content search and grep". Spec: `SPECs/fuzzy-search-grep-spec.md`.
Add full-content fuzzy search + grep across the workspace (today only filename search exists).

## Reviewed

- `SPECs/fuzzy-search-grep-spec.md` — spec (fuzzy default, `/` grep prefix, ripgrep suggested but live-scan OK for v1).
- `src-tauri/src/commands/search.rs` — existing `fuzzy_search` over `file_index`; `ignore::WalkBuilder` already a dep; `index_workspace_impl` parallel walker.
- `src-tauri/src/state.rs` — `WorkspaceState.file_index` is already gitignore-filtered (reuse, no new dep).
- `src/lib/tauri.ts` — IPC bridge (`fuzzySearch` pattern to mirror).
- `types/fs.ts` — already has a forward-declared (unused) `ContentSearchResult`; align naming to spec's `ContentMatch`.
- `components/command-palette/` — cmdk palette pattern + `HighlightedPath` to mirror.
- `hooks/use-keyboard-shortcuts.ts` — Cmd+P search; add Cmd+Shift+F.
- `components/sidebar/file-browser.tsx` — sidebar search button (add content-search icon).
- `lib/pending-anchor.ts` + `use-prosemark-editor.ts` — pending-anchor → mirror for line-jump; `scrollHeadingIntoView` math to reuse for `scrollLineIntoView`.
- `hooks/editor-api.ts`, `editor-pane.tsx` — view registry point for same-doc jump.

## Decision: no ripgrep dependency

Spec suggests the `grep` crate, but `file_index` is already gitignore-filtered and the `ignore` crate is present. For v1 live scan, iterate `file_index`, read each file, match lines in parallel via `std::thread::scope`. Avoids a heavy new dependency + network fetch. Indexing deferred per spec.

## Changes

### Rust (`commands/search.rs`)

- `ContentMatch { path, relative_path, line_number, line_text, match_ranges: Vec<[u32;2]>, score }`.
- `ContentSearchOptions { limit_per_file, limit_total }`.
- `#[tauri::command] search_workspace_content(query, options, webview, app)`.
- `search_workspace_content_impl`: grep mode (`/` prefix, literal, all occurrences) vs fuzzy (all tokens must appear in a line, first-occurrence ranges). Scoring: heading bonus, early-line bonus, filename-stem bonus, token-proximity bonus. Per-file cap (10) + total cap (500). Parallel reads.
- Helper fns: `grep_ranges`, `fuzzy_ranges`, `heading_bonus`, `early_line_bonus`, `cap_line`, `clamp_ranges`.
- Unit tests.
- Register in `lib.rs` generate_handler.

### Frontend

- `types/fs.ts`: rename `ContentSearchResult` → `ContentMatch` (`line_text`), align to spec.
- `lib/tauri.ts`: `searchWorkspaceContent(query, options?)`.
- `hooks/use-content-search.ts`: debounced (~120ms) hook.
- `components/content-search-palette.tsx`: cmdk dialog, grouped by file, sticky headers, highlighted match ranges, Enter → jump.
- `stores/ui-store.ts`: `isContentSearchOpen`, `openContentSearch`, `closeContentSearch` + hooks file.
- `App.tsx`: render `<ContentSearchPalette />`.
- `hooks/use-keyboard-shortcuts.ts`: Cmd+Shift+F (workspace only).
- `components/sidebar/file-browser.tsx`: content-search icon button (⌘⇧F).
- `lib/pending-line-jump.ts`: mirror `pending-anchor`.
- `components/editor-area/use-prosemark-editor.ts`: `lineJumpHighlight` mark decoration + `scrollLineIntoView` + consume pending on swap; export `applyLineJump`.
- `hooks/editor-api.ts`: `jumpToLine(path, line, ranges)` + view registry `registerEditorView`/`getEditorView`.
- `components/editor-area/editor-pane.tsx`: register view.
- `App.css`: `.cm-content-search-highlight` style.

## Tests

- Rust: fuzzy finds body token, grep `/` prefix, empty query, per-file limit.
- Frontend: `use-content-search` groups/empty; unit test for `grep_ranges`/`fuzzy_ranges` (Rust covers matching).
- Manual: `vp dev`, Cmd+Shift+F, type, click result, confirm scroll + brief highlight.

## Risks

- Reading all files per keystroke is heavy on huge vaults — mitigated by debounce (120ms) + caps; can add index later.
- `vp dev`/Tauri build may not run in this sandbox (signing/macOS); validate via `vp check`, `vp test`, `cargo test` (offline if target cached).
