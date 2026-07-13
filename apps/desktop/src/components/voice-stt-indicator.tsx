import { useEffect } from "react";
import { useVoiceSttStore, ensureVoiceSttListeners } from "@/hooks/use-voice-stt";

// Relative heights of the five bars — taller toward the center for a natural
// waveform shape. Multiplied by the live input level.
const BAR_WEIGHTS = [0.5, 0.78, 1, 0.78, 0.5];

/** Animated, voice-reactive waveform. Bars rise with the live mic level so the
 *  user gets clear feedback that dictation is hearing them — without a jittery
 *  half-word text preview. */
function Waveform({ level }: { level: number }) {
  return (
    <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
      {BAR_WEIGHTS.map((w, i) => {
        const height = 3 + level * 17 * w;
        return (
          <span
            key={i}
            className="w-[3px] rounded-full bg-accent transition-[height] duration-100 ease-out motion-reduce:transition-none"
            style={{ height: `${height}px` }}
          />
        );
      })}
    </span>
  );
}

export function VoiceSttIndicator() {
  const phase = useVoiceSttStore((s) => s.phase);
  const modelStatus = useVoiceSttStore((s) => s.modelStatus);
  const modelDownloaded = useVoiceSttStore((s) => s.modelDownloaded);
  const modelTotal = useVoiceSttStore((s) => s.modelTotal);
  const modelError = useVoiceSttStore((s) => s.modelError);
  const level = useVoiceSttStore((s) => s.level);
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

  if (phase === "starting") {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-sm text-text-muted">Starting dictation…</span>
      </div>
    );
  }

  if (phase !== "listening") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
      <Waveform level={level} />
      <span className="text-sm text-text-muted">Listening…</span>
      <button
        type="button"
        onClick={stop}
        className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:bg-muted"
      >
        Stop
      </button>
    </div>
  );
}
