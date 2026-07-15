// Greyed, live "dictation overlay" rendered at the cursor while the user
// speaks. The backend streams partial hypotheses via `voice-stt-partial`; we
// anchor a non-editable widget just after the committed text so the user sees
// the words appear as they talk. On `voice-stt-final` the text is committed to
// the document and the overlay is cleared. Modeled on `voice-highlight.ts`.

import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

class DictationOverlayWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DictationOverlayWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-dictation-overlay";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

interface OverlayState {
  pos: number;
  text: string;
}

const setOverlay = StateEffect.define<OverlayState | null>();

const overlayField = StateField.define<OverlayState | null>({
  create: () => null,
  update(value, tr) {
    const set = tr.effects.find((e) => e.is(setOverlay));
    if (set) return set.value;
    // A committed final also dispatches a setOverlay(null) in the same
    // transaction, so a plain doc change leaves the overlay untouched.
    return value;
  },
});

const overlayDecoration = EditorView.decorations.compute([overlayField], (state) => {
  const v = state.field(overlayField);
  if (!v || v.text.length === 0) return Decoration.none;
  const pos = Math.min(v.pos, state.doc.length);
  return Decoration.set([
    Decoration.widget({
      widget: new DictationOverlayWidget(v.text),
      side: 1,
    }).range(pos),
  ]);
});

export const dictationOverlayExtension = [overlayField, overlayDecoration];

/** Show / replace the live partial text anchored at `pos`. */
export function setDictationOverlay(view: EditorView, pos: number, text: string): void {
  view.dispatch({ effects: setOverlay.of({ pos, text }) });
}

/** Clear the overlay (on commit / stop / idle). */
export function clearDictationOverlay(view: EditorView): void {
  try {
    view.dispatch({ effects: setOverlay.of(null) });
  } catch {
    // View may be destroyed; nothing to clear.
  }
}
