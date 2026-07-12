import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import type { ContentMatch } from "@/types/fs";
import { useCloseContentSearch, useIsContentSearchOpen } from "@/hooks/use-content-search-store";
import { useContentSearch } from "@/hooks/use-content-search";
import * as editorApi from "@/hooks/editor-api";
import { getFileName } from "@/lib/paths";

function HighlightedLine({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <>{text}</>;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([start, end], i) => {
    const s = Math.max(0, Math.min(start, text.length));
    const e = Math.max(s, Math.min(end, text.length));
    if (s > cursor) parts.push(<span key={`t${i}`}>{text.slice(cursor, s)}</span>);
    parts.push(
      <mark key={`m${i}`} className="cm-content-search-highlight-inline">
        {text.slice(s, e)}
      </mark>,
    );
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}

export function ContentSearchPalette() {
  const isOpen = useIsContentSearchOpen();
  const close = useCloseContentSearch();
  const [search, setSearch] = useState("");
  const results = useContentSearch(search);

  // Clear the query when the palette closes so the next open starts fresh.
  useEffect(() => {
    if (!isOpen) setSearch("");
  }, [isOpen]);

  const grouped = useMemo(() => {
    const map = new Map<string, ContentMatch[]>();
    for (const m of results) {
      const arr = map.get(m.path);
      if (arr) arr.push(m);
      else map.set(m.path, [m]);
    }
    return Array.from(map.entries());
  }, [results]);

  const firstValue =
    grouped.length > 0 ? `${grouped[0]![1][0]!.path}:${grouped[0]![1][0]!.line_number}` : "";

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState(firstValue);

  // Snap selection + scroll to the first item whenever results shift.
  // selectedValue is also set by cmdk on keyboard nav. firstValue is a
  // primitive, so this is stable across renders.
  /* eslint-disable react-doctor/no-derived-state */
  useEffect(() => {
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [search, firstValue]);
  /* eslint-enable react-doctor/no-derived-state */

  function handleSelect(match: ContentMatch) {
    close();
    editorApi.jumpToLine(match.path, match.line_number, match.match_ranges);
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      label="Search in Files"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder="Search in files…  (/ for exact match)"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList ref={listRef}>
        {search.trim() === "" ? (
          <CommandEmpty>Type to search file contents across the workspace.</CommandEmpty>
        ) : results.length === 0 ? (
          <CommandEmpty>No matches found.</CommandEmpty>
        ) : (
          grouped.map(([path, matches]) => (
            <CommandGroup key={path} heading={getFileName(path)}>
              {matches.map((m) => {
                const value = `${m.path}:${m.line_number}`;
                return (
                  <CommandItem key={value} value={value} onSelect={() => handleSelect(m)}>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-mono text-[12px] text-text-muted">
                        {m.relative_path}:{m.line_number}
                      </span>
                      <span className="truncate text-[13px]">
                        <HighlightedLine text={m.line_text} ranges={m.match_ranges} />
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))
        )}
      </CommandList>
    </CommandDialog>
  );
}
