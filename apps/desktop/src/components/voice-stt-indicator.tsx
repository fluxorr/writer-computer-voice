import { useEffect } from "react";
import { useVoiceSttStore, ensureVoiceSttListeners } from "@/hooks/use-voice-stt";
import { useSettingsStore } from "@/stores/settings-store";

// Relative heights of the five bars — taller toward the center for a natural
// waveform shape. Multiplied by the live input level.
const BAR_WEIGHTS = [0.5, 0.78, 1, 0.78, 0.5];

type SegOption<T extends string> = { value: T; label: string };

/** A quiet segmented control: the active option carries weight + surface, the
 *  rest stay muted. Not the slop fill-vs-outline pair — one shared track. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
            className={
              "rounded-full px-2.5 py-0.5 text-xs transition-colors " +
              (active
                ? "bg-background font-medium text-text shadow-sm"
                : "text-text-muted hover:text-text")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Engine + model switcher shown on the active dictation pill. Writing a
 *  setting and calling `restart()` re-runs dictation with the new choice. */
function DictationPicker() {
  const engine =
    (useSettingsStore((s) => s.settings["voice.stt.engine"]) as string | undefined) ===
    "apple-native"
      ? "apple-native"
      : "sherpa";
  const model =
    (useSettingsStore((s) => s.settings["voice.stt.model"]) as string | undefined) ??
    "nemotron-streaming";
  const setSetting = useSettingsStore((s) => s.setSetting);
  const restart = useVoiceSttStore((s) => s.restart);

  const apply = (key: string, val: string) => {
    void setSetting(key, val).then(() => restart());
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        ariaLabel="Dictation engine"
        value={engine as "sherpa" | "apple-native"}
        onChange={(v) => apply("voice.stt.engine", v)}
        options={[
          { value: "sherpa", label: "Local" },
          { value: "apple-native", label: "Apple" },
        ]}
      />
      {engine === "sherpa" ? (
        <Segmented
          ariaLabel="Dictation model"
          value={model as "nemotron-streaming" | "parakeet-tdt-v3"}
          onChange={(v) => apply("voice.stt.model", v)}
          options={[
            { value: "nemotron-streaming", label: "Nemotron" },
            { value: "parakeet-tdt-v3", label: "Parakeet" },
          ]}
        />
      ) : null}
    </div>
  );
}

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

  if (phase === "starting") {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-sm text-text-muted">Starting dictation…</span>
      </div>
    );
  }

  if (phase !== "listening") return null;

  const preview = liveText.trim();

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[min(92vw,640px)] -translate-x-1/2 flex-col gap-2 rounded-2xl border border-border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-3">
        <Waveform level={level} />
        {preview ? (
          <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{preview}</span>
        ) : (
          <span className="flex-1 text-sm text-text-muted">Listening…</span>
        )}
        <button
          type="button"
          onClick={stop}
          className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:bg-muted"
        >
          Stop
        </button>
      </div>
      <DictationPicker />
    </div>
  );
}
