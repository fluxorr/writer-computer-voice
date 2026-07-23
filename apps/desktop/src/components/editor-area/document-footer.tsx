import { useCallback } from "react";
import { forceLinting } from "@codemirror/lint";
import { getEditorView } from "@/lib/editor-view-registry";
import { useFileStats } from "@/hooks/use-tabs";

function FooterMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[var(--text-muted)]">{value.toLocaleString()}</span>
      <span>{label}</span>
    </div>
  );
}

export function DocumentFooter({ filePath }: { filePath: string }) {
  const stats = useFileStats(filePath);

  const handleGrammarCheck = useCallback(() => {
    const view = getEditorView(filePath);
    if (view) forceLinting(view);
  }, [filePath]);

  return (
    <div className="flex absolute bottom-0 w-full z-10 h-11 shrink-0 items-center justify-end gap-5 px-6 text-[13px] leading-[1.15] text-[var(--text-muted)] md:px-8">
      <button
        type="button"
        onClick={handleGrammarCheck}
        className="cursor-default border-0 bg-transparent p-0 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        Check Grammar
      </button>
      <span className="flex items-center gap-1 text-[var(--text-muted)]">
        <span className="text-[var(--text-muted)]">{stats.readingTime} min</span>
        <span>read</span>
      </span>
      <FooterMetric label="words" value={stats.words} />
      <FooterMetric label="characters" value={stats.characters} />
      <FooterMetric label="paragraphs" value={stats.paragraphs} />
    </div>
  );
}
