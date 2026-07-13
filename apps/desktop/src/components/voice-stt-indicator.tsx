import { useEffect } from "react";
import { useVoiceSttStore, ensureVoiceSttListeners } from "@/hooks/use-voice-stt";

export function VoiceSttIndicator() {
  const isListening = useVoiceSttStore((s) => s.isListening);
  const modelStatus = useVoiceSttStore((s) => s.modelStatus);
  const modelDownloaded = useVoiceSttStore((s) => s.modelDownloaded);
  const modelTotal = useVoiceSttStore((s) => s.modelTotal);
  const modelError = useVoiceSttStore((s) => s.modelError);
  const liveText = useVoiceSttStore((s) => s.liveText);
  const error = useVoiceSttStore((s) => s.error);
  const stop = useVoiceSttStore((s) => s.stop);

  useEffect(() => {
    ensureVoiceSttListeners();
  }, []);

  const pct = modelTotal > 0 ? Math.min(100, Math.round((modelDownloaded / modelTotal) * 100)) : 0;

  if (modelError) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-500/40 bg-background/95 px-3 py-2 text-xs text-red-400 shadow-lg backdrop-blur">
        Dictation model failed: {modelError}
      </div>
    );
  }

  if (modelStatus === "downloading") {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 w-64 -translate-x-1/2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
        <div className="mb-1 text-xs text-text-muted">Downloading voice model… {pct}%</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-500/40 bg-background/95 px-3 py-2 text-xs text-red-400 shadow-lg backdrop-blur">
        Dictation error: {error}
      </div>
    );
  }

  if (!isListening) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[80vw] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
      </span>
      <span className="truncate text-sm text-text">
        {liveText || <span className="text-text-muted">Listening…</span>}
      </span>
      <button
        type="button"
        onClick={stop}
        className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-text-muted hover:bg-muted"
      >
        Stop
      </button>
    </div>
  );
}
