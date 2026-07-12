import { useEffect, useRef, useState } from "react";
import * as tauri from "@/lib/tauri";
import type { ContentMatch } from "@/types/fs";

// Debounced full-content search across the workspace. The Rust command scans
// the gitignore-filtered file index in parallel; we debounce keystrokes so we
// don't issue a scan on every character. Empty queries return no results.
export function useContentSearch(
  query: string,
  limitPerFile = 10,
  limitTotal = 500,
): ContentMatch[] {
  const [results, setResults] = useState<ContentMatch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasQuery = query.trim() !== "";

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      void tauri.searchWorkspaceContent(query, { limitPerFile, limitTotal }).then(setResults);
    }, 120);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, limitPerFile, limitTotal, hasQuery]);

  return hasQuery ? results : [];
}
