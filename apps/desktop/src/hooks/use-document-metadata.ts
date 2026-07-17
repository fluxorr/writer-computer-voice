import { useEffect, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { readFileMetadata } from "@/lib/tauri";
import type { FileMetadata } from "@/types/fs";
import { formatRelativeOrAbsolute } from "@/lib/relative-time";

export interface DocumentMetadataLabels {
  updatedLabel: string | null;
  createdLabel: string | null;
}

/** Load filesystem metadata (created/modified timestamps) for the given file
 *  path and merge with frontmatter-sourced display dates. Returns formatted
 *  labels suitable for rendering near the document title. Labels are
 *  re-computed every 60 seconds so relative times stay current. */
export function useDocumentMetadata(path: string | null): DocumentMetadataLabels {
  const displayDate = useEditorStore(
    (s) => (path ? s.openFiles.get(path)?.displayDate : undefined) ?? null,
  );
  const [fsMeta, setFsMeta] = useState<FileMetadata | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    setFsMeta(null);
    if (!path) return;

    let cancelled = false;
    void readFileMetadata(path)
      .then((meta) => {
        if (!cancelled) setFsMeta(meta);
      })
      .catch(() => {
        if (!cancelled) setFsMeta(null);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  // Refresh the relative-time labels every 60 seconds so "2 mins ago" does
  // not stay frozen until the next file change.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowSecs = Math.floor(Date.now() / 1000);
  const updatedLabel = fsMeta ? formatRelativeOrAbsolute(fsMeta.modified_at, nowSecs) : null;
  const createdLabel =
    displayDate ??
    (fsMeta?.created_at ? formatRelativeOrAbsolute(fsMeta.created_at, nowSecs) : null);

  return { updatedLabel, createdLabel };
}
