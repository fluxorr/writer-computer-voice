// Highlights a content-search match in the editor and scrolls it into view.
// Mirrors the anchor-jump flow (`pending-anchor` + `scrollHeadingIntoView`)
// but targets a line + character ranges instead of a heading slug.

import { EditorView, Decoration } from "@codemirror/view";
import { StateField, StateEffect, EditorSelection, type Extension } from "@codemirror/state";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

const lineJumpEffect = StateEffect.define<Array<{ from: number; to: number }> | null>();

// Holds the currently highlighted match ranges (doc positions), or null.
const lineJumpState = StateField.define<Array<{ from: number; to: number }> | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.find((e) => e.is(lineJumpEffect));
    if (set) return set.value;
    // A document edit invalidates stale character ranges — drop the highlight.
    if (tr.docChanged) return null;
    return value;
  },
});

const lineJumpMark = Decoration.mark({ class: "cm-content-search-highlight" });

const lineJumpDecorations = EditorView.decorations.compute([lineJumpState], (state) => {
  const ranges = state.field(lineJumpState);
  if (!ranges || ranges.length === 0) return Decoration.none;
  return Decoration.set(ranges.map((r) => lineJumpMark.range(r.from, r.to)));
});

function findOuterScroller(view: EditorView): HTMLElement | null {
  let el: HTMLElement | null = view.dom.parentElement;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

export function scrollLineIntoView(
  view: EditorView,
  scroller: HTMLElement,
  lineNumber: number,
  behavior: ScrollBehavior,
) {
  const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  const block = view.lineBlockAt(line.from);
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior });
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleClearLineJump(view: EditorView) {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (!view.dom.isConnected) return;
    try {
      view.dispatch({ effects: lineJumpEffect.of(null) });
    } catch {
      // View may have been destroyed; nothing to clear.
    }
  }, 2000);
}

export function clearLineJump(view: EditorView) {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  try {
    view.dispatch({ effects: lineJumpEffect.of(null) });
  } catch {
    // View may have been destroyed; nothing to clear.
  }
}

/** Apply a content-search match highlight + scroll for a given line. */
export function applyLineJump(view: EditorView, lineNumber: number, ranges: [number, number][]) {
  const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  const marks = ranges
    .map(([start, end]) => ({
      from: line.from + Math.max(0, Math.min(start, line.length)),
      to: line.from + Math.max(0, Math.min(end, line.length)),
    }))
    .filter((r) => r.to > r.from);

  view.dispatch({
    effects: lineJumpEffect.of(marks.length > 0 ? marks : null),
    selection: EditorSelection.cursor(marks.length > 0 ? marks[0].from : line.from),
  });

  const scroller = findOuterScroller(view);
  if (scroller) scrollLineIntoView(view, scroller, line.number, "smooth");
  scheduleClearLineJump(view);
}

// Combined extension: register the highlight StateField AND derive the
// decoration from it. The StateField must be present in the editor state or
// `state.field(lineJumpState)` throws "Field is not present in this state".
export const lineJumpExtension: Extension = [lineJumpState, lineJumpDecorations];
