// Frontend dictation (STT) controller. Talks to the Rust `voice_stt_*` commands
// and renders live state via the `VoiceSttIndicator`. Whisper runs locally
// (model auto-downloaded to app data on first use); text streams back as
// incremental, already-committed deltas and is inserted at a captured cursor
// position as the user speaks.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  voiceSttEnsureModel,
  voiceSttStart,
  voiceSttStop,
  type VoiceSttModelStatus,
  type VoiceSttDelta,
  type VoiceSttLevel,
  type VoiceSttStatus,
} from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { getActiveFilePath } from "@/hooks/editor-api";
import { getEditorView } from "@/lib/editor-view-registry";

type Phase = "idle" | "starting" | "listening" | "error";

function sttConfig() {
  const s = useSettingsStore.getState().settings;
  return {
    model: String((s["voice.stt.model"] as string | undefined) ?? "base.en"),
    language: String((s["voice.stt.language"] as string | undefined) ?? "en"),
    autopunctuate: Boolean(s["voice.stt.autopunctuate"] ?? false),
  };
}

// Where the next committed text goes. Captured the moment dictation starts so
// it tracks the document the user was looking at, not wherever the cursor
// drifts later.
let startPath: string | null = null;
let insertPos: number | null = null;

function applyDelta(text: string) {
  if (!text || startPath == null || insertPos == null) return;
  const view = getEditorView(startPath);
  if (!view) return;
  const docLen = view.state.doc.length;
  let from = insertPos;
  if (from > docLen) from = docLen;
  if (from < 0) from = 0;
  // Insert a space before the new text if we're mid-word, so segments join
  // naturally. Whisper already adds trailing punctuation/spaces as needed.
  let insert = text;
  if (from > 0) {
    const before = view.state.doc.sliceString(from - 1, from);
    if (before.trim() !== "" && !text.startsWith(" ") && !text.startsWith("\n")) {
      insert = " " + text;
    }
  }
  view.dispatch({
    changes: { from, to: from, insert },
    selection: { anchor: from + insert.length },
  });
  insertPos = from + insert.length;
}

interface VoiceSttState {
  phase: Phase;
  modelStatus: VoiceSttModelStatus["status"];
  modelDownloaded: number;
  modelTotal: number;
  modelError: string | null;
  liveText: string;
  /** Live mic amplitude (0..1) for the animated indicator. */
  level: number;
  error: string | null;
  start: () => void;
  stop: () => void;
}

// Set once so we know listeners are registered; the module is imported by the
// indicator (always mounted in a workspace window) and also at app init.
let listenersReady = false;
// True while we've asked the backend to ensure the model and are waiting for
// the "ready" event before actually starting capture.
let awaitingModelForStart = false;

export const useVoiceSttStore = create<VoiceSttState>((set, get) => ({
  phase: "idle",
  modelStatus: "idle",
  modelDownloaded: 0,
  modelTotal: 0,
  modelError: null,
  liveText: "",
  level: 0,
  error: null,

  start: () => {
    const st = get();
    if (st.phase === "listening" || st.phase === "starting") {
      get().stop();
      return;
    }
    const { model } = sttConfig();
    awaitingModelForStart = true;
    set({
      phase: "starting",
      error: null,
      modelError: null,
      modelStatus: "downloading",
      modelDownloaded: 0,
      liveText: "",
    });
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
        useVoiceSttStore.setState({ phase: "error", error: String(e) });
      });
    }
  } else if (p.status === "error") {
    awaitingModelForStart = false;
    useVoiceSttStore.setState({ modelStatus: "error", modelError: p.message });
  }
}

function onDelta(event: { payload: VoiceSttDelta }) {
  const text = event.payload.text.trim();
  if (!text) return;
  applyDelta(text);
  useVoiceSttStore.setState((s) => {
    const next = s.liveText ? `${s.liveText} ${text}` : text;
    return { liveText: next.length > 2000 ? next.slice(next.length - 2000) : next };
  });
}

function onLevel(event: { payload: VoiceSttLevel }) {
  const level = event.payload.level;
  // Only paint while listening; avoids stray levels from a detached worker.
  if (useVoiceSttStore.getState().phase !== "listening") return;
  useVoiceSttStore.setState({ level });
}

function onStatus(event: { payload: VoiceSttStatus }) {
  const p = event.payload;
  if (p.status === "listening") {
    // Capture the insertion point now, before the cursor can move.
    const path = getActiveFilePath();
    const view = path ? getEditorView(path) : null;
    startPath = path ?? null;
    insertPos = view ? view.state.selection.main.head : null;
    useVoiceSttStore.setState({ phase: "listening", liveText: "", level: 0, error: null });
  } else if (p.status === "idle") {
    startPath = null;
    insertPos = null;
    useVoiceSttStore.setState({ phase: "idle", liveText: "", level: 0 });
  } else if (p.status === "error") {
    useVoiceSttStore.setState({ phase: "error", error: p.message ?? "dictation error" });
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
  register("voice-stt-delta", onDelta as never);
  register("voice-stt-level", onLevel as never);
  register("voice-stt-status", onStatus as never);
}

// Register as soon as this module is imported (app startup), so dictation
// events are handled even before the indicator mounts.
ensureVoiceSttListeners();
