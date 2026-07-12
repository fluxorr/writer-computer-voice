// Carries a pending content-search line jump across the gap between
// `jumpToLine` (which triggers an async load + an editor swap) and the
// editor's first render of the new document. Keyed by absolute file path.
// Consumed exactly once.

const pending = new Map<string, { line: number; ranges: [number, number][] }>();

export function setPendingLineJump(
  path: string,
  payload: { line: number; ranges: [number, number][] },
): void {
  pending.set(path, payload);
}

export function consumePendingLineJump(
  path: string,
): { line: number; ranges: [number, number][] } | undefined {
  const payload = pending.get(path);
  if (payload !== undefined) pending.delete(path);
  return payload;
}
