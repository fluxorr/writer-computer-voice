// Frontend read-aloud (TTS) controller built on the Web Speech API.
//
// On macOS the WebView's SpeechSynthesis uses the system's offline voices
// (AVFoundation under the hood), so read-aloud stays fully local-first and
// emits `boundary` events we use to drive the karaoke word highlight. This
// avoids a separate native Rust command while keeping the same offline
// behavior the spec calls for.

import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { getActiveFilePath } from "@/hooks/editor-api";
import { getEditorView } from "@/lib/editor-view-registry";
import { useSettingsStore } from "@/stores/settings-store";
import { applyVoiceHighlight, clearVoiceHighlight } from "@/components/editor-area/voice-highlight";

export type VoiceScope = "cursor" | "selection" | "document";

interface VoiceTtsState {
  isPlaying: boolean;
  isPaused: boolean;
  scope: VoiceScope;
  setScope: (scope: VoiceScope) => void;
  read: (scope?: VoiceScope) => void;
  toggle: () => void;
  stop: () => void;
}

// ----- module-level controller state (speech is a singleton) -----

let activeView: EditorView | null = null;

function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function getTtsConfig() {
  const s = useSettingsStore.getState().settings;
  return {
    rate: Number(s["voice.tts.rate"] ?? 1),
    pitch: Number(s["voice.tts.pitch"] ?? 1),
    voice: String((s["voice.tts.voice"] as string | undefined) ?? ""),
  };
}

function clearHighlight() {
  if (activeView) {
    try {
      clearVoiceHighlight(activeView);
    } catch {
      // view may be destroyed
    }
  }
}

function endSession() {
  activeView = null;
  useVoiceTtsStore.setState({ isPlaying: false, isPaused: false });
}

function computeRange(scope: VoiceScope): { view: EditorView; from: number; to: number } | null {
  const path = getActiveFilePath();
  const view = path ? getEditorView(path) : null;
  if (!view) return null;

  const doc = view.state.doc;
  const sel = view.state.selection.main;
  let from: number;
  let to: number;

  if (scope === "document") {
    from = 0;
    to = doc.length;
  } else if (scope === "selection" && !sel.empty) {
    from = sel.from;
    to = sel.to;
  } else {
    // cursor, or empty selection falls back to cursor
    from = sel.head;
    to = doc.length;
  }

  return { view, from, to };
}

function read(scopeFromCaller?: VoiceScope) {
  if (!speechSupported()) {
    console.warn("[voice] Web Speech API unavailable in this environment");
    return;
  }

  const scope = scopeFromCaller ?? useVoiceTtsStore.getState().scope;
  const range = computeRange(scope);
  if (!range) return;

  const { view, from, to } = range;
  const text = view.state.doc.sliceString(from, to);
  if (!text.trim()) return;

  // Cancel anything currently queued/spoken before starting fresh.
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  const cfg = getTtsConfig();
  u.rate = cfg.rate;
  u.pitch = cfg.pitch;
  if (cfg.voice) {
    const v = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === cfg.voice);
    if (v) u.voice = v;
  }

  activeView = view;

  u.onboundary = (event: SpeechSynthesisEvent) => {
    if (!activeView) return;
    const ci = event.charIndex;
    let len = event.charLength;
    if (!len || len <= 0) {
      const rest = text.slice(ci);
      const next = rest.search(/\s/);
      len = next === -1 ? rest.length : next;
    }
    applyVoiceHighlight(activeView, from + ci, from + ci + len);
  };
  u.onend = () => endSession();
  u.onerror = () => endSession();

  window.speechSynthesis.speak(u);
  useVoiceTtsStore.setState({ isPlaying: true, isPaused: false });
}

function toggle() {
  if (!speechSupported()) return;
  const st = useVoiceTtsStore.getState();
  if (st.isPlaying && !st.isPaused) {
    window.speechSynthesis.pause();
    useVoiceTtsStore.setState({ isPaused: true });
  } else if (st.isPaused) {
    window.speechSynthesis.resume();
    useVoiceTtsStore.setState({ isPaused: false });
  } else {
    read();
  }
}

function stop() {
  if (speechSupported()) window.speechSynthesis.cancel();
  clearHighlight();
  endSession();
}

export const useVoiceTtsStore = create<VoiceTtsState>((set) => ({
  isPlaying: false,
  isPaused: false,
  scope: (useSettingsStore.getState().settings["voice.tts.scope"] as VoiceScope) ?? "cursor",
  setScope: (scope) => {
    set({ scope });
    // Remember the last chosen scope in settings.
    void useSettingsStore.getState().setSetting("voice.tts.scope", scope);
  },
  read: (scope) => read(scope),
  toggle: () => toggle(),
  stop: () => stop(),
}));
