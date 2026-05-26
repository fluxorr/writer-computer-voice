import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  type EditorState,
  type Extension,
  Prec,
  type Range,
  StateField,
  type StateCommand,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import { eventHandlersWithClass } from "../utils";

// Single source of truth for the width of the visual list prefix unit.
// Drives widget sizing and hanging-indent geometry together — tweak this
// constant to resize the whole list-rendering column.
const LIST_UNIT_CH = 3;

// Cap on how far `findPrevListItemIndent` walks backward looking for a
// parent. List nesting in practice is shallow; this avoids O(n) on giant
// docs with no blank-line breaks between items.
const PREV_LIST_LOOKBACK = 256;
const LIST_INDENT_SPACES = 2;

// Measurable source-backed rendering of bullet/task prefixes. Leading nesting
// spaces render as fixed-width spacer marks, then the marker source (`- ` or
// `- [ ] `) renders as a fixed-width prefix mark. CSS hides the source text and
// draws the visible marker on the same span, so hit-testing and drawn selection
// geometry see stable text boxes rather than collapsed spans plus widget tiles.
const listIndentSpacerDecoration = Decoration.mark({
  class: "cm-list-indent-spacer",
  attributes: { style: `width: ${LIST_UNIT_CH.toString()}ch` },
});

const listPrefixDecoration = (kind: "bullet" | "task", checked = false) => {
  const classes = ["cm-list-prefix", `cm-list-prefix-${kind}`];
  if (checked) classes.push("cm-list-prefix-task-checked");
  return Decoration.mark({
    class: classes.join(" "),
    attributes: {
      style: [
        `width: ${LIST_UNIT_CH.toString()}ch`,
        "--cm-list-marker-offset: 0ch",
        `--cm-list-marker-width: ${LIST_UNIT_CH.toString()}ch`,
      ].join("; "),
    },
  });
};

// Internal marker decoration (no visible class) — used purely to populate
// the marker / atomic range sets for the `listBackspace` handler and
// arrow-key skipping. Replaces the previous shared `bulletMarkerDecoration`
// which doubled as both rendering and tracking.
const listPrefixMarkerDecoration = Decoration.mark({});

// Wraps the body text of a list item (everything after the prefix through
// end of line) in a `<span class="cm-list-body">`, so consumers can style
// body content distinctly from the marker.
const listBodyDecoration = Decoration.mark({ class: "cm-list-body" });

const isBulletMarkChar = (ch: string): boolean => ch === "-" || ch === "+" || ch === "*";

// Ordered-list markers per CommonMark: a run of digits followed by `.` or `)`.
const ORDERED_MARKER_RE = /^\d+[.)]$/;
const isOrderedMarkText = (s: string): boolean => ORDERED_MARKER_RE.test(s);

// Line-level hanging indent applied to ordered-list lines: the marker hangs
// in the left gutter and wrapped continuation aligns with the body column.
// Ordered markers stay as source text (the digits matter), but the marker span
// has a minimum width so one- and two-digit numbers share the same visual
// column while longer markers can still grow.
const orderedLineDecoration = Decoration.line({
  attributes: {
    style: `padding-inline-start: ${LIST_UNIT_CH.toString()}ch; text-indent: -3.4ch;`,
  },
});
const orderedMarkerDecoration = Decoration.mark({
  class: "cm-list-ordered-marker",
  attributes: { style: `min-width: ${LIST_UNIT_CH.toString()}ch;` },
});

// A list marker is followed by a space OR tab per CommonMark; accept both
// in the trailing-char gates so tab-separated markers render.
const isMarkerTrailingChar = (ch: string): boolean => ch === " " || ch === "\t";

interface ListDecorations {
  /** Marker + spacers + body wraps + per-line hanging-indent. Drives
   *  rendering. */
  all: DecorationSet;
  /** Drives atomic cursor motion — every source prefix/indent step skips as a
   *  unit. */
  atomic: DecorationSet;
  /** Bullet + task ranges only. Backspace at one of these right edges
   *  extends the deletion to `line.from`, so wiping the marker also clears
   *  the leading indent that was carrying its nesting. */
  marker: DecorationSet;
}

function buildListDecorations(state: EditorState): ListDecorations {
  const allRanges: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const markerRanges: Range<Decoration>[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "ListMark") return;

      // Require a trailing space/tab so a bare marker the user just typed
      // (no whitespace yet) renders as plain text, not a list. Lezer's
      // incremental parse can emit `ListMark` for the bare marker before
      // the whitespace arrives.
      if (!isMarkerTrailingChar(state.doc.sliceString(node.to, node.to + 1))) return;

      // Ordered-list markers (`1.`, `2)`): keep the marker as source text
      // (no widget), but fix its visual column before applying the line's
      // hanging indent. We intentionally skip spacers to keep ordered
      // rendering minimal.
      const markText = state.doc.sliceString(node.from, node.to);
      if (isOrderedMarkText(markText)) {
        const line = state.doc.lineAt(node.from);
        const prefixEnd = node.to + 1;
        allRanges.push(orderedMarkerDecoration.range(node.from, node.to));
        if (prefixEnd < line.to) {
          allRanges.push(listBodyDecoration.range(prefixEnd, line.to));
        }
        allRanges.push(orderedLineDecoration.range(line.from));
        return;
      }

      // Bullet lists only beyond this point — skip anything else.
      if (markText.length !== 1 || !isBulletMarkChar(markText)) return;

      // Depth = number of ancestor `ListItem` nodes above the item this
      // mark belongs to. Top-level items have depth 0; one level of nesting
      // has depth 1; etc.
      let depth = -1;
      for (let p = node.node.parent; p; p = p.parent) {
        if (p.name === "ListItem") depth++;
      }
      if (depth < 0) depth = 0;

      // Indent-step spacer marks — one fixed-width mark per nesting level,
      // tracking the source char ranges so arrow keys and Backspace treat
      // each two-space step as a unit. The source spaces stay measurable,
      // but visually they collapse to one predictable spacer column.
      const line = state.doc.lineAt(node.from);
      const leadingFrom = line.from;
      const leadingTo = node.from;
      const leadingLen = leadingTo - leadingFrom;
      if (leadingLen > 0) {
        for (let subFrom = leadingFrom; subFrom < leadingTo; subFrom += LIST_INDENT_SPACES) {
          const subTo = Math.min(subFrom + LIST_INDENT_SPACES, leadingTo);
          allRanges.push(listIndentSpacerDecoration.range(subFrom, subTo));
          atomicRanges.push(listPrefixMarkerDecoration.range(subFrom, subTo));
        }
      }

      // Task vs plain bullet: both render one measurable source-backed prefix
      // mark over the full source prefix. Avoid widgets here: horizontal drag
      // selection should hit normal inline boxes, not widget boundaries.
      const cursor = node.node.cursor();
      let prefixEnd = -1;
      let prefixKind: "bullet" | "task" = "bullet";
      let checked = false;
      if (cursor.nextSibling() && cursor.name === "Task") {
        const taskCursor = cursor.node.cursor();
        if (
          taskCursor.firstChild() &&
          taskCursor.name === "TaskMarker" &&
          isMarkerTrailingChar(state.doc.sliceString(taskCursor.to, taskCursor.to + 1))
        ) {
          checked =
            state.doc.sliceString(taskCursor.from + 1, taskCursor.to - 1).toLowerCase() === "x";
          prefixEnd = taskCursor.to + 1;
          prefixKind = "task";
        }
      }
      if (prefixEnd < 0) {
        prefixEnd = node.to + 1;
      }
      allRanges.push(listPrefixDecoration(prefixKind, checked).range(node.from, prefixEnd));
      // Marker / atomic tracking — `listBackspace` checks `decos.marker`
      // for the right-edge-of-prefix case (delete the whole prefix back to
      // line.from), and `decos.atomic` already carries indent-step ranges
      // from the loop above. Add the full-prefix range to both.
      const fullPrefixDeco = listPrefixMarkerDecoration.range(line.from, prefixEnd);
      markerRanges.push(fullPrefixDeco);
      atomicRanges.push(fullPrefixDeco);

      // Wrap the body text (everything after the prefix through end of
      // line) so consumers can style it via `.cm-list-body`. Skipped when
      // the item is empty (no body content).
      if (prefixEnd < line.to) {
        allRanges.push(listBodyDecoration.range(prefixEnd, line.to));
      }

      // Hanging-indent on every list line: pad the line by the rendered
      // prefix width and pull the first visual line back by the same amount.
      // The prefix mark occupies that pulled-back slot, while wrapped
      // continuation lines keep the padding so body text stays aligned.
      const prefixCh = (depth + 1) * LIST_UNIT_CH;
      const lineStyle = `padding-inline-start: ${prefixCh.toString()}ch; text-indent: -${prefixCh.toString()}ch;`;
      allRanges.push(Decoration.line({ attributes: { style: lineStyle } }).range(line.from));
    },
  });

  return {
    all: Decoration.set(allRanges, true),
    atomic: Decoration.set(atomicRanges, true),
    marker: Decoration.set(markerRanges, true),
  };
}

const listDecorationsField = StateField.define<ListDecorations>({
  create(state) {
    return buildListDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildListDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.all),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
});

// Find the indent of the nearest list-item line above `lineNumber` whose
// own indent matches the predicate. Used by indent / outdent to align the
// current line to a valid CommonMark parent. Returns -1 if none found
// before a blank line breaks the list context, or after PREV_LIST_LOOKBACK
// lines (defensive cap so giant docs don't pay an O(n) scan per keystroke).
const findPrevListItemIndent = (
  state: EditorState,
  lineNumber: number,
  predicate: (indent: number) => boolean,
): number => {
  const stop = Math.max(1, lineNumber - PREV_LIST_LOOKBACK);
  for (let i = lineNumber - 1; i >= stop; i--) {
    const prev = state.doc.line(i);
    const text = prev.text;
    if (text.trim() === "") return -1;
    const m = /^([ \t]*)[-+*] /.exec(text);
    if (m && predicate(m[1].length)) return m[1].length;
  }
  return -1;
};

const currentLineIndentLen = (lineText: string): number =>
  /^[ \t]*/.exec(lineText)?.[0].length ?? 0;

// Captures the indent + marker + optional task-marker prefix of any bullet/task
// line. Used by Enter continuation and list indentation commands.
const LIST_LINE_PREFIX_RE = /^([ \t]*)([-+*]) (\[.\] )?/;

// Walk the syntax tree across the entire line range looking for a list
// marker. The previous `resolveInner(pos)` ancestor-walk approach worked
// for bullets but missed empty tasks: with the cursor at the end of
// `- [ ] ` the resolved node sits outside the `ListItem` and the walk
// never reaches it. Iterating the line range catches `ListMark` /
// `TaskMarker` regardless of where the caret sits on the line.
const isOnListLine = (state: EditorState, pos: number): boolean => {
  const line = state.doc.lineAt(pos);
  let found = false;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === "ListMark" || node.name === "TaskMarker") {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
};

const selectedLineNumbers = (state: EditorState): number[] => {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const endPos = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const toLine = state.doc.lineAt(endPos);
    for (let number = fromLine.number; number <= toLine.number; number++) {
      numbers.add(number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
};

const listIndentSelection: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  let sawListLine = false;

  for (const lineNumber of selectedLineNumbers(state)) {
    const line = state.doc.line(lineNumber);
    const match = LIST_LINE_PREFIX_RE.exec(line.text);
    if (!match) continue;
    sawListLine = true;

    const currentIndent = match[1]?.length ?? 0;
    const prevIndent = findPrevListItemIndent(state, line.number, (i) => i <= currentIndent);
    if (prevIndent < 0) continue;

    const targetIndent = prevIndent + LIST_INDENT_SPACES;
    if (currentIndent >= targetIndent) continue;

    changes.push({ from: line.from, insert: " ".repeat(targetIndent - currentIndent) });
  }

  if (!sawListLine) return false;
  if (changes.length > 0) {
    dispatch(state.update({ changes, userEvent: "input.indent" }));
  }
  return true;
};

const listOutdentSelection: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  let sawListLine = false;

  for (const lineNumber of selectedLineNumbers(state)) {
    const line = state.doc.line(lineNumber);
    const match = LIST_LINE_PREFIX_RE.exec(line.text);
    if (!match) continue;
    sawListLine = true;

    const currentIndent = match[1]?.length ?? 0;
    if (currentIndent === 0) continue;

    const removeLen = Math.min(LIST_INDENT_SPACES, currentIndent);
    changes.push({ from: line.from, to: line.from + removeLen });
  }

  if (!sawListLine) return false;
  if (changes.length > 0) {
    dispatch(state.update({ changes, userEvent: "delete.outdent" }));
  }
  return true;
};

// `StateCommand` signature instead of `(view) => boolean` keeps the
// handlers testable: tests can call them with `{state, dispatch}` directly
// (no `EditorView`/DOM needed). EditorView satisfies the same shape, so
// they still bind to the keymap without changes.

// Tab on a list line: nest one level deeper by aligning to the previous
// list item's content column (= prev indent + 2 for `- ` markers). That
// matches CommonMark's rule that a nested item's indent must be ≥ the
// parent's content column, while staying within the parent's `+3` window
// (which is what blanket "insert 2 spaces" violates once the chain of
// parents above isn't deep enough — Lezer reclassifies the line as a code
// continuation and the bullet vanishes). Always consumes Tab on a list
// line (even when nesting is a no-op) so `indentWithTab` doesn't fall
// through and insert a literal `\t` — that would break the list parse.
const listIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return listIndentSelection({ state, dispatch });
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const currentIndent = currentLineIndentLen(line.text);

  const prevIndent = findPrevListItemIndent(state, line.number, (i) => i <= currentIndent);
  if (prevIndent < 0) return true;
  const targetIndent = prevIndent + LIST_INDENT_SPACES;
  if (currentIndent >= targetIndent) return true;

  const insertLen = targetIndent - currentIndent;
  dispatch(
    state.update({
      changes: { from: line.from, insert: " ".repeat(insertLen) },
      selection: { anchor: sel.head + insertLen },
      userEvent: "input.indent",
    }),
  );
  return true;
};

// Shift-Tab on a list line: align to the nearest previous list item with
// a strictly shallower indent — i.e. step up one nesting level.
const listOutdent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return listOutdentSelection({ state, dispatch });
  }
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);
  const currentIndent = currentLineIndentLen(line.text);
  if (currentIndent === 0) return true;

  const prevIndent = findPrevListItemIndent(state, line.number, (i) => i < currentIndent);
  const targetIndent = Math.max(0, prevIndent);

  const removeLen = currentIndent - targetIndent;
  if (removeLen <= 0) return true;

  const cursorOffsetInLine = sel.head - line.from;
  const newHead = line.from + Math.max(targetIndent, cursorOffsetInLine - removeLen);
  dispatch(
    state.update({
      changes: { from: line.from, to: line.from + removeLen },
      selection: { anchor: newHead },
      userEvent: "delete.outdent",
    }),
  );
  return true;
};

// Matches a line whose content is only a list marker (bullet or task) and
// the required trailing space — i.e. an empty list item the user typed
// `Enter` on. Captures optional leading whitespace for nested empties.
const EMPTY_LIST_LINE_RE = /^[ \t]*[-+*] (\[.\] )?$/;

const listEnter: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  // Multi-cursor / non-empty selection: fall through to default Enter
  // (insert newline) — list-aware splitting on multi-line selections is
  // out of scope for now.
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const sel = state.selection.main;
  if (!isOnListLine(state, sel.head)) return false;

  const line = state.doc.lineAt(sel.head);

  // Empty list item → wipe and break out of the list.
  if (EMPTY_LIST_LINE_RE.test(line.text)) {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        userEvent: "delete.empty-list-marker",
      }),
    );
    return true;
  }

  // Smart continuation: mirror the line's `<indent><marker> ` (with `[ ] `
  // for tasks, always unchecked) onto the new line so a new item exists
  // immediately after the marker + space, as soon as the user hits Enter.
  const match = LIST_LINE_PREFIX_RE.exec(line.text);
  if (!match) return false;
  const indent = match[1] ?? "";
  const marker = match[2] ?? "-";
  const isTask = match[3] !== undefined;

  // Defer to the default Enter when the cursor sits at/before the prefix's
  // end — splitting before the marker shouldn't duplicate it.
  const cursorOffsetInLine = sel.head - line.from;
  const prefixLen = match[0].length;
  if (cursorOffsetInLine < prefixLen) return false;

  const continuation = isTask ? `${indent}${marker} [ ] ` : `${indent}${marker} `;
  dispatch(
    state.update({
      changes: { from: sel.head, insert: `\n${continuation}` },
      selection: { anchor: sel.head + 1 + continuation.length },
      userEvent: "input.list-continue",
    }),
  );
  return true;
};

// CodeMirror 6's `deleteCharBackward` from `@codemirror/commands` DOES
// respect `atomicRanges` via `skipAtomic` — but it deletes exactly the
// atomic range, not more. This handler is what gives the user-visible
// "Backspace at a bullet wipes the leading indent too" behavior: at a
// marker's right edge, deletion is extended to `line.from`. At a spacer's
// right edge, just the spacer's source chars go (one indent step). The
// handler is also what makes lang-markdown's `deleteMarkupBackward` skip
// list-line backspacing (we return true and stop the chain).
const findEndsAt = (set: DecorationSet, lineStart: number, head: number): number => {
  let from = -1;
  set.between(lineStart, head, (rangeFrom, rangeTo) => {
    if (rangeTo === head) {
      from = rangeFrom;
      return false;
    }
    return undefined;
  });
  return from;
};

const listBackspace: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;

  const head = range.head;
  const decos = state.field(listDecorationsField);
  const lineStart = state.doc.lineAt(head).from;

  // Bullet/task first: extend to line.from so leading indent goes with it.
  if (findEndsAt(decos.marker, lineStart, head) >= 0) {
    dispatch(
      state.update({
        changes: { from: lineStart, to: head },
        selection: { anchor: lineStart },
        userEvent: "delete.list",
      }),
    );
    return true;
  }

  // Spacer: delete just the one indent step's chars.
  const spacerFrom = findEndsAt(decos.atomic, lineStart, head);
  if (spacerFrom < 0) return false;
  dispatch(
    state.update({
      changes: { from: spacerFrom, to: head },
      selection: { anchor: spacerFrom },
      userEvent: "delete.list",
    }),
  );
  return true;
};

// Click-toggle for the checkbox prefix. Keep this on `click`, not `mousedown`:
// mousedown is CodeMirror's drag-selection start gesture, and consuming it makes
// TODO lines feel broken when the user drags across the checkbox. A drag won't
// fire click, so selection and toggle stay distinct.
export const computeCheckboxToggle = (
  state: EditorState,
  widgetStartPos: number,
): TransactionSpec | null => {
  const slice = state.doc.sliceString(widgetStartPos, widgetStartPos + 8);
  const m = /^[-+*] \[([ xX])\][ \t]/.exec(slice);
  if (!m) return null;
  const innerCharPos = widgetStartPos + 3; // position of the ` ` or `x` inside `[ ]`
  const currentlyChecked = m[1]?.toLowerCase() === "x";
  return {
    changes: {
      from: innerCharPos,
      to: innerCharPos + 1,
      insert: currentlyChecked ? " " : "x",
    },
    userEvent: "input.toggle-checkbox",
  };
};

const computeCheckboxToggleFromLine = (state: EditorState, pos: number): TransactionSpec | null => {
  const line = state.doc.lineAt(pos);
  const match = /^([ \t]*)[-+*] \[[ xX]\][ \t]/.exec(line.text);
  if (!match) return null;
  const indentLen = match[1]?.length ?? 0;
  return computeCheckboxToggle(state, line.from + indentLen);
};

const checkboxClickHandler = EditorView.domEventHandlers(
  eventHandlersWithClass({
    click: {
      "cm-list-prefix-task": (ev, view) => {
        const pos = view.posAtDOM(ev.target as HTMLElement);
        const spec =
          computeCheckboxToggleFromLine(view.state, pos) ?? computeCheckboxToggle(view.state, pos);
        if (!spec) return false;
        view.dispatch(spec);
        return true; // prevent default
      },
    },
  }),
);

export const listExtension: Extension = [
  listDecorationsField,
  // `Prec.highest` wins over `@codemirror/lang-markdown`'s `Prec.high`
  // keymap (which also binds Enter and Backspace via
  // `insertNewlineContinueMarkup` / `deleteMarkupBackward`). On non-list
  // contexts (ordered lists, blockquotes, ATX headings) our handlers
  // return false and lang-markdown's still runs — that's how blockquote
  // `> ` deletion and ordered-list `1. ` continuation are preserved.
  Prec.highest(
    keymap.of([
      { key: "Backspace", run: listBackspace },
      { key: "Enter", run: listEnter },
      { key: "Tab", run: listIndent },
      { key: "Shift-Tab", run: listOutdent },
    ]),
  ),
  checkboxClickHandler,
];

// Internals exposed only for tests. Not part of the public API.
export const __test = {
  buildListDecorations,
  computeCheckboxToggleFromLine,
  isOnListLine,
  findPrevListItemIndent,
  currentLineIndentLen,
  listEnter,
  listBackspace,
  listIndent,
  listOutdent,
  EMPTY_LIST_LINE_RE,
  LIST_LINE_PREFIX_RE,
  LIST_UNIT_CH,
  listDecorationsField,
};
