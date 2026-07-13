// Highlights the currently-spoken span during read-aloud (TTS) and scrolls it
// into view. Mirrors `editor-line-jump.ts` but driven by the Web Speech API's
// `boundary` events on the frontend (macOS WebView uses the offline system
// voices, so this stays local-first).

import { EditorView, Decoration } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { EDITOR_SAFE_SCROLL_MARGIN } from "./editor-scroll-container";

const voiceHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();

const voiceHighlightState = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.find((e) => e.is(voiceHighlightEffect));
    if (set) return set.value;
    if (tr.docChanged) return null;
    return value;
  },
});

const voiceHighlightMark = Decoration.mark({ class: "cm-tts-highlight" });

export const voiceHighlightDecorations = EditorView.decorations.compute(
  [voiceHighlightState],
  (state) => {
    const v = state.field(voiceHighlightState);
    if (!v) return Decoration.none;
    return Decoration.set([voiceHighlightMark.range(v.from, v.to)]);
  },
);

export const voiceHighlightExtension = [voiceHighlightState, voiceHighlightDecorations];

function findOuterScroller(view: EditorView): HTMLElement | null {
  let el: HTMLElement | null = view.dom.parentElement;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

export function scrollToOffset(view: EditorView, pos: number) {
  const scroller = findOuterScroller(view);
  if (!scroller) return;
  const block = view.lineBlockAt(pos);
  const screenY = view.documentTop + block.top;
  const scrollerRect = scroller.getBoundingClientRect();
  const delta = screenY - scrollerRect.top - EDITOR_SAFE_SCROLL_MARGIN;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const next = Math.max(0, Math.min(scroller.scrollTop + delta, max));
  scroller.scrollTo({ top: next, behavior: "smooth" });
}

export function applyVoiceHighlight(view: EditorView, from: number, to: number) {
  view.dispatch({ effects: voiceHighlightEffect.of({ from, to }) });
  scrollToOffset(view, from);
}

export function clearVoiceHighlight(view: EditorView) {
  try {
    view.dispatch({ effects: voiceHighlightEffect.of(null) });
  } catch {
    // View may be destroyed; nothing to clear.
  }
}
