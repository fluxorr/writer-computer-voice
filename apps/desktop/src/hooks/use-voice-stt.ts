// Frontend dictation (STT) controller. Talks to the Rust `voice_stt_*` commands
// and renders live state via the `VoiceSttIndicator`. Whisper runs locally
// (model auto-downloaded to app data on first use); text streams back as the
// user speaks and is inserted at the cursor when dictation stops.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  voiceSttEnsureModel,
  voiceSttStart,
  voiceSttStop,
  type VoiceSttModelStatus,
  type VoiceSttPartial,
  type VoiceSttFinal,
  type VoiceSttStatus,
} from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { getActiveFilePath } from "@/hooks/editor-api";
import { getEditorView } from "@/lib/editor-view-registry";

function sttConfig() {
  const s = useSettingsStore.getState().settings;
  return {
    model: String((s["voice.stt.model"] as string | undefined) ?? "base.en"),
    language: String((s["voice.stt.language"] as string | undefined) ?? "en"),
    autopunctuate: Boolean(s["voice.stt.autopunctuate"] ?? false),
  };
}

function insertAtCursor(text: string) {
  const path = getActiveFilePath();
  const view = path ? getEditorView(path) : null;
  if (!view || !text) return;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

interface VoiceSttState {
  isListening: boolean;
  modelStatus: VoiceSttModelStatus["status"];
  modelDownloaded: number;
  modelTotal: number;
  modelError: string | null;
  liveText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

// Set once so we know listeners are registered; the module is imported by the
// indicator, which is always mounted in a workspace window.
let listenersReady = false;
// True while we've asked the backend to ensure the model and are waiting for
// the "ready" event before actually starting capture.
let awaitingModelForStart = false;

export const useVoiceSttStore = create<VoiceSttState>((set, get) => ({
  isListening: false,
  modelStatus: "idle",
  modelDownloaded: 0,
  modelTotal: 0,
  modelError: null,
  liveText: "",
  error: null,

  start: () => {
    if (get().isListening) {
      get().stop();
      return;
    }
    const { model } = sttConfig();
    awaitingModelForStart = true;
    set({ error: null, modelError: null, modelStatus: "downloading", modelDownloaded: 0 });
    // The backend emits `voice-stt-model` "ready" (or downloads then "ready");
    // the model-ready handler kicks off `voice_stt_start`.
    void voiceSttEnsureModel(model);
  },

  stop: () => {
    awaitingModelForStart = false;
    void voiceSttStop();
  },
}));

function onModel(event: { payload: VoiceSttModelStatus }) {
  const p = event.payload;
  if (p.status === "downloading") {
    useVoiceSttStore.setState({
      modelStatus: "downloading",
      modelDownloaded: p.downloaded,
      modelTotal: p.total,
    });
  } else if (p.status === "ready") {
    useVoiceSttStore.setState({ modelStatus: "ready", modelDownloaded: 0, modelTotal: 0 });
    if (awaitingModelForStart) {
      awaitingModelForStart = false;
      const { model, language, autopunctuate } = sttConfig();
      void voiceSttStart(model, language, autopunctuate).catch((e) => {
        useVoiceSttStore.setState({ error: String(e), isListening: false });
      });
    }
  } else if (p.status === "error") {
    awaitingModelForStart = false;
    useVoiceSttStore.setState({ modelStatus: "error", modelError: p.message });
  }
}

function onPartial(event: { payload: VoiceSttPartial }) {
  useVoiceSttStore.setState({ liveText: event.payload.text });
}

function onFinal(event: { payload: VoiceSttFinal }) {
  insertAtCursor(event.payload.text);
  useVoiceSttStore.setState({ liveText: "", isListening: false });
}

function onStatus(event: { payload: VoiceSttStatus }) {
  const p = event.payload;
  if (p.status === "listening") {
    useVoiceSttStore.setState({ isListening: true, liveText: "", error: null });
  } else if (p.status === "idle") {
    useVoiceSttStore.setState({ isListening: false });
  } else if (p.status === "error") {
    useVoiceSttStore.setState({ isListening: false, error: p.message ?? "dictation error" });
  }
}

/** Register the whisper event listeners exactly once. Safe to call repeatedly. */
export function ensureVoiceSttListeners(): void {
  if (listenersReady) return;
  listenersReady = true;
  const register = (event: string, handler: (e: { payload: unknown }) => void): void => {
    void listen(event, handler as (e: unknown) => void).then((_unlisten: UnlistenFn) => {
      // Listeners live for the app lifetime; no need to unlisten.
    });
  };
  register("voice-stt-model", onModel as never);
  register("voice-stt-partial", onPartial as never);
  register("voice-stt-final", onFinal as never);
  register("voice-stt-status", onStatus as never);
}
