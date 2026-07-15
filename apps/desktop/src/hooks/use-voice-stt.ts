// Frontend dictation (STT) controller. Talks to the Rust `voice_stt_*` commands
// and renders live state via the `VoiceSttIndicator`. The Rust side runs
// sherpa-onnx locally (model auto-downloaded to app data on first use) and
// streams two events: `voice-stt-partial` (the live, replaceable hypothesis)
// shown as a greyed overlay at the cursor, and `voice-stt-final` (the
// committed utterance) inserted into the document at the captured cursor.

import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  voiceSttEnsureModel,
  voiceSttStart,
  voiceSttStop,
  type VoiceSttEngine,
  type VoiceSttModelStatus,
  type VoiceSttPartial,
  type VoiceSttFinal,
  type VoiceSttLevel,
  type VoiceSttStatus,
} from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { getActiveFilePath } from "@/hooks/editor-api";
import { getEditorView } from "@/lib/editor-view-registry";
import {
  setDictationOverlay,
  clearDictationOverlay,
} from "@/components/editor-area/dictation-overlay";

type Phase = "idle" | "starting" | "listening" | "error";

function sttConfig() {
  const s = useSettingsStore.getState().settings;
  const engine: VoiceSttEngine =
    (s["voice.stt.engine"] as string | undefined) === "apple-native" ? "apple-native" : "sherpa";
  return {
    engine,
    model: String((s["voice.stt.model"] as string | undefined) ?? "nemotron-streaming"),
    language: String((s["voice.stt.language"] as string | undefined) ?? "en"),
    autopunctuate: Boolean(s["voice.stt.autopunctuate"] ?? false),
  };
}

// Where the next committed text goes. Captured the moment dictation starts so
// it tracks the document the user was looking at, not wherever the cursor
// drifts later. `insertPos` is the end of committed text — the overlay anchors
// just after it.
let startPath: string | null = null;
let insertPos: number | null = null;

function activeView() {
  if (startPath == null) return null;
  return getEditorView(startPath);
}

/** Commit a finalized utterance into the document at the cursor, advance the
 *  commit point, and clear the live overlay in the same transaction. */
function applyFinal(text: string) {
  if (!text || startPath == null || insertPos == null) return;
  const view = activeView();
  if (!view) return;
  const docLen = view.state.doc.length;
  let from = insertPos;
  if (from > docLen) from = docLen;
  if (from < 0) from = 0;
  let insert = text;
  if (from > 0) {
    const before = view.state.doc.sliceString(from - 1, from);
    if (before.trim() !== "" && !text.startsWith(" ") && !text.startsWith("\n")) {
      insert = " " + text;
    }
  }
  const nextPos = from + insert.length;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: { anchor: nextPos },
  });
  // The just-committed words must not linger as greyed overlay text.
  clearDictationOverlay(view);
  insertPos = nextPos;
}

/** Show / update the live partial hypothesis as a greyed overlay. */
function applyPartial(text: string) {
  if (startPath == null || insertPos == null) return;
  const view = activeView();
  if (!view) return;
  if (text.length === 0) {
    clearDictationOverlay(view);
  } else {
    setDictationOverlay(view, insertPos, text);
  }
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
  /** Restart with the current settings (used after switching engine/model from
   *  the picker). If listening, waits for a clean stop before starting again. */
  restart: () => void;
}

// Set once so we know listeners are registered; the module is imported by the
// indicator (always mounted in a workspace window) and also at app init.
let listenersReady = false;
// True while we've asked the backend to ensure the model and are waiting for
// the "ready" event before actually starting capture.
let awaitingModelForStart = false;
// True while a settings change (engine/model) is waiting for the current
// session to fully stop (`idle`) before starting again with the new config.
let pendingRestart = false;

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
    const { engine, model } = sttConfig();
    awaitingModelForStart = true;
    set({
      phase: "starting",
      error: null,
      modelError: null,
      modelStatus: "downloading",
      modelDownloaded: 0,
      liveText: "",
    });
    // The backend emits `voice-stt-model` "ready" (sherpa: download then ready;
    // apple-native: authorization granted); the model-ready handler kicks off
    // `voice_stt_start`.
    void voiceSttEnsureModel(engine, model);
  },

  stop: () => {
    awaitingModelForStart = false;
    void voiceSttStop();
  },

  restart: () => {
    const st = get();
    if (st.phase === "listening" || st.phase === "starting") {
      // Defer the restart until the backend confirms it has stopped (`idle`),
      // so we never race a new session against the old one's teardown.
      pendingRestart = true;
      awaitingModelForStart = false;
      void voiceSttStop();
    } else {
      get().start();
    }
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
      const { engine, model, language, autopunctuate } = sttConfig();
      void voiceSttStart(engine, model, language, autopunctuate).catch((e) => {
        useVoiceSttStore.setState({ phase: "error", error: String(e) });
      });
    }
  } else if (p.status === "error") {
    awaitingModelForStart = false;
    useVoiceSttStore.setState({ modelStatus: "error", modelError: p.message });
  }
}

function onPartial(event: { payload: VoiceSttPartial }) {
  const text = event.payload.text;
  if (useVoiceSttStore.getState().phase !== "listening") return;
  applyPartial(text);
  useVoiceSttStore.setState({
    liveText: text.length > 2000 ? text.slice(text.length - 2000) : text,
  });
}

function onFinal(event: { payload: VoiceSttFinal }) {
  const text = event.payload.text.trim();
  if (!text) return;
  applyFinal(text);
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
    if (view) clearDictationOverlay(view);
    useVoiceSttStore.setState({ phase: "listening", liveText: "", level: 0, error: null });
  } else if (p.status === "idle") {
    if (startPath) {
      const view = activeView();
      if (view) clearDictationOverlay(view);
    }
    startPath = null;
    insertPos = null;
    useVoiceSttStore.setState({ phase: "idle", liveText: "", level: 0 });
    // A queued engine/model switch starts a fresh session now that the old one
    // has fully torn down.
    if (pendingRestart) {
      pendingRestart = false;
      useVoiceSttStore.getState().start();
    }
  } else if (p.status === "error") {
    useVoiceSttStore.setState({ phase: "error", error: p.message ?? "dictation error" });
  }
}

/** Register the dictation event listeners exactly once. Safe to call repeatedly. */
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
  register("voice-stt-level", onLevel as never);
  register("voice-stt-status", onStatus as never);
}

// Register as soon as this module is imported (app startup), so dictation
// events are handled even before the indicator mounts.
ensureVoiceSttListeners();
