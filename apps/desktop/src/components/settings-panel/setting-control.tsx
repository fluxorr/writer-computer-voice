import { useEffect, useState } from "react";
import type { SettingDef } from "@/lib/settings-schema";

interface SettingControlProps {
  def: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
  isModified: boolean;
}

function BooleanControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label="Toggle setting"
      className="relative h-5 w-9 rounded-full transition-colors duration-200"
      style={{
        backgroundColor: value ? "var(--link-color)" : "var(--border-color)",
      }}
    >
      <span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function NumberControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      aria-label="Number value"
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-28 h-9 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

function StringControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      aria-label="Text value"
      onChange={(e) => onChange(e.target.value)}
      className="w-64 h-9 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
    />
  );
}

function EnumControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[140px] h-9 appearance-none rounded-lg border border-transparent bg-[var(--surface-input)] bg-[length:12px_12px] bg-[position:right_10px_center] bg-no-repeat pl-3 pr-8 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none bg-[image:var(--select-chevron)]"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** Number of decimals implied by a range step (e.g. 0.1 → 1, 5 → 0). Keeps
 *  fractional ranges like read-aloud rate/pitch from rounding to integers. */
function stepDecimals(step: number): number {
  if (!step || step >= 1) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function formatRangeValue(value: number, step: number): string {
  const decimals = stepDecimals(step);
  return Number(value).toFixed(decimals);
}

function ColorControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Local text state so the user can type intermediate invalid hex while editing.
  // Callers key this component on `value` so an external value change remounts it
  // and resets `text` to the new value.
  // Intentional editable local copy: caller keys this on `value` so external changes remount and reset; local state allows typing intermediate invalid hex before commit.
  // eslint-disable-next-line react-doctor/no-derived-useState
  const [text, setText] = useState(value);

  function commit(next: string) {
    if (HEX_RE.test(next)) {
      onChange(next.toUpperCase());
    } else {
      setText(value);
    }
  }

  const swatch = HEX_RE.test(value) ? value : "#000000";

  return (
    <div className="relative inline-flex h-9 w-44 items-center gap-2 rounded-lg bg-[var(--surface-input)] pr-3 pl-1">
      <span
        className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-[var(--border-color)]"
        style={{ backgroundColor: swatch }}
      >
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label="Pick color"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </span>
      <input
        type="text"
        value={text}
        aria-label="Hex color value"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        spellCheck={false}
        className="flex-1 bg-transparent font-mono text-[13px] uppercase tracking-wide text-[var(--text-secondary)] outline-none"
      />
    </div>
  );
}

function RangeControl({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label="Range value"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-44 appearance-none rounded-full bg-[var(--surface-subtle)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
      />
      <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-[var(--text-muted)]">
        {formatRangeValue(value, step)}
      </span>
    </div>
  );
}

function ListControl({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleAdd() {
    onChange([...value, ""]);
  }

  function handleChange(index: number, newVal: string) {
    const updated = [...value];
    updated[index] = newVal;
    onChange(updated);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {value.map((item, i) => (
        // eslint-disable-next-line react-doctor/no-array-index-as-key -- positional string[] (may be empty/duplicated) bound to controlled inputs by position; a value-derived key would collide on dupes and remount inputs on each keystroke.
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            aria-label={`List item ${i + 1}`}
            onChange={(e) => handleChange(i, e.target.value)}
            className="h-9 w-64 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            aria-label="Remove item"
            className="pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-[var(--text-icon-muted)] hover:text-[var(--text-secondary)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="mr-6 flex h-9 w-64 items-center justify-center rounded-lg border border-dashed border-[var(--line-subtle)] text-[13px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        + Add
      </button>
    </div>
  );
}

function ShortcutControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);

  // While recording, capture the next key combo. Ignore bare modifier taps
  // (need at least one non-modifier key) and never capture Esc (cancels).
  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const mods: string[] = [];
      if (e.metaKey || e.ctrlKey) mods.push("Cmd");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      const isModifier =
        e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift";
      if (isModifier) return;
      const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      onChange([...mods, key].join("+"));
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  if (recording) {
    return (
      <span className="inline-flex h-9 min-w-[140px] items-center justify-center rounded-lg border border-[var(--focus-border)] bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)]">
        Press keys…
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      className="inline-flex h-9 min-w-[140px] items-center justify-center gap-1 rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] transition-colors hover:border-[var(--focus-border)]"
    >
      {value.split("+").map((part, i) => (
        <kbd
          key={i}
          className="rounded bg-[var(--kbd-bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
        >
          {part}
        </kbd>
      ))}
    </button>
  );
}

function speechVoicesSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Read-aloud voice picker backed by the platform's SpeechSynthesis voices
 *  (system offline macOS voices in the WebView). Stores the stable `voiceURI`;
 *  an empty value means the system default voice. */
function VoiceSelectControl({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!speechVoicesSupported()) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices());
    load();
    // Voices often populate asynchronously after the first `getVoices()` call.
    synth.onvoiceschanged = load;
    return () => {
      synth.onvoiceschanged = null;
    };
  }, []);

  if (!speechVoicesSupported()) {
    return <StringControl value={value} onChange={onChange} />;
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Read-aloud voice"
      className="min-w-[200px] h-9 appearance-none rounded-lg border border-transparent bg-[var(--surface-input)] bg-[length:12px_12px] bg-[position:right_10px_center] bg-no-repeat pl-3 pr-8 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none bg-[image:var(--select-chevron)]"
    >
      <option value="">System Default</option>
      {voices.map((v) => (
        <option key={v.voiceURI} value={v.voiceURI}>
          {v.name}
          {v.lang ? ` · ${v.lang}` : ""}
        </option>
      ))}
    </select>
  );
}

/** Dispatch a control widget for a SettingDef. The single switch keeps the
 *  schema → control mapping centralized; any view rendering settings should
 *  use this rather than re-implementing the type dispatch. */
function Control({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (def.type) {
    case "boolean":
      return <BooleanControl value={value as boolean} onChange={onChange} />;
    case "number":
      return <NumberControl value={value as number} onChange={onChange} />;
    case "string":
      return <StringControl value={value as string} onChange={onChange} />;
    case "voice":
      return <VoiceSelectControl value={(value as string) ?? ""} onChange={onChange} />;
    case "enum":
      return (
        <EnumControl value={value as string} options={def.options ?? []} onChange={onChange} />
      );
    case "list":
      return <ListControl value={(value as string[]) ?? []} onChange={onChange} />;
    case "color":
      return <ColorControl key={value as string} value={value as string} onChange={onChange} />;
    case "range":
      return (
        <RangeControl
          value={value as number}
          min={def.min ?? 0}
          max={def.max ?? 100}
          step={def.step ?? 1}
          onChange={onChange}
        />
      );
    case "shortcut":
      return <ShortcutControl value={(value as string) ?? ""} onChange={onChange} />;
  }
}

export function SettingControl({ def, value, onChange, onReset, isModified }: SettingControlProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--text-primary)]">{def.label}</div>
        {def.description && (
          <div className="mt-0.5 text-[13px] text-[var(--text-muted)]">{def.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          tabIndex={isModified ? 0 : -1}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-subtle-strong)] hover:text-[var(--text-primary)] ${
            isModified ? "" : "invisible pointer-events-none"
          }`}
          title="Reset to default"
        >
          Reset
        </button>
        <Control def={def} value={value} onChange={onChange} />
      </div>
    </div>
  );
}
