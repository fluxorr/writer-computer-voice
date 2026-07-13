import { useVoiceTtsStore, type VoiceScope } from "@/lib/voice-tts";
import { useSetting } from "@/hooks/use-settings";

const SCOPES: { value: VoiceScope; label: string }[] = [
  { value: "cursor", label: "Cursor" },
  { value: "selection", label: "Selection" },
  { value: "document", label: "Document" },
];

export function VoiceTtsMiniplayer() {
  const isPlaying = useVoiceTtsStore((s) => s.isPlaying);
  const isPaused = useVoiceTtsStore((s) => s.isPaused);
  const scope = useVoiceTtsStore((s) => s.scope);
  const setScope = useVoiceTtsStore((s) => s.setScope);
  const toggle = useVoiceTtsStore((s) => s.toggle);
  const stop = useVoiceTtsStore((s) => s.stop);
  const setRate = useVoiceTtsStore((s) => s.setRate);

  const rate = Number(useSetting("voice.tts.rate") ?? 1);

  if (!isPlaying && !isPaused) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={toggle}
        title={isPaused ? "Resume" : "Pause"}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-background hover:opacity-90"
      >
        {isPaused ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M4 2.5v11l9-5.5z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M3 3h3v10H3zM10 3h3v10h-3z" />
          </svg>
        )}
      </button>

      <button
        type="button"
        onClick={stop}
        title="Stop"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-muted"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <rect x="3" y="3" width="10" height="10" rx="1.5" />
        </svg>
      </button>

      <div className="flex items-center overflow-hidden rounded-lg border border-border">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setScope(s.value)}
            className={`px-2 py-1 text-xs ${
              scope === s.value ? "bg-accent text-background" : "text-text-muted hover:bg-muted"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-muted">
        Speed
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={rate}
          aria-label="Read-aloud speed"
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-20 accent-[var(--accent)]"
        />
        <span className="w-8 tabular-nums">{rate.toFixed(1)}x</span>
      </label>
    </div>
  );
}
