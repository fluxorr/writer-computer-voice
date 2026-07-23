import { linter, type Diagnostic } from "@codemirror/lint";
import { type Extension } from "@codemirror/state";

interface LanguageToolMatch {
  message: string;
  offset: number;
  length: number;
  rule: { id: string; description: string; issueType: string };
  replacements: { value: string }[];
}

interface LanguageToolResponse {
  matches: LanguageToolMatch[];
}

function toSeverity(issueType: string): "warning" | "error" {
  if (issueType === "misspelling" || issueType === "typographical") return "error";
  return "warning";
}

export function grammarLinter(): Extension {
  return linter(
    async (view) => {
      const text = view.state.doc.toString();
      if (!text.trim()) return [];

      try {
        const res = await fetch("https://api.languagetool.org/v2/check", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ text, language: "en-US" }),
        });

        if (!res.ok) return [];

        const data: LanguageToolResponse = await res.json();

        return data.matches.map(
          (match): Diagnostic => ({
            from: match.offset,
            to: match.offset + match.length,
            severity: toSeverity(match.rule.issueType),
            message: `${match.message}${
              match.replacements.length > 0
                ? ` — Suggested: ${match.replacements
                    .slice(0, 3)
                    .map((r) => r.value)
                    .join(", ")}`
                : ""
            }`,
            source: "grammar-check",
          }),
        );
      } catch {
        return [];
      }
    },
    { needsRefresh: () => false, delay: 0 },
  );
}
