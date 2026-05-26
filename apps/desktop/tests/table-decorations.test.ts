import { describe, expect, test } from "vite-plus/test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { foldExtension } from "../src/lib/prosemark-core/main";
import {
  parseTableCellInlineMarkdown,
  tableDecorations,
} from "../src/components/editor-area/table-decorations";

const before = "before\n";
const table = ["| Name | Count |", "| --- | ---: |", "| Tea | 2 |"].join("\n");
const after = "\n\nafter";
const doc = before + table + after;
const tableFrom = before.length;
const tableTo = tableFrom + table.length;

type FoldDecoration = {
  from: number;
  to: number;
  className: string;
  hasWidget: boolean;
};

function makeState(anchor: number, head = anchor): EditorState {
  let state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] }), tableDecorations()],
    selection: EditorSelection.single(anchor, head),
  });
  ensureSyntaxTree(state, doc.length, 1000);
  state = state.update({ selection: state.selection }).state;
  return state;
}

function collectFoldDecorations(state: EditorState): FoldDecoration[] {
  const decorations: FoldDecoration[] = [];
  state.field(foldExtension).between(0, doc.length, (from, to, decoration) => {
    const spec = decoration.spec as { class?: string; widget?: unknown };
    decorations.push({
      from,
      to,
      className: spec.class ?? "",
      hasWidget: spec.widget !== undefined,
    });
  });
  return decorations;
}

describe("tableDecorations", () => {
  test("parses inline markdown for folded table preview cells", () => {
    expect(
      parseTableCellInlineMarkdown(
        "**Bold** _em_ `code` [link](https://example.test) ~~gone~~ &amp; &lt; \\|",
      ),
    ).toEqual([
      { type: "element", tag: "strong", children: [{ type: "text", text: "Bold" }] },
      { type: "text", text: " " },
      { type: "element", tag: "em", children: [{ type: "text", text: "em" }] },
      { type: "text", text: " " },
      {
        type: "element",
        tag: "code",
        className: "cm-inline-code",
        children: [{ type: "text", text: "code" }],
      },
      { type: "text", text: " " },
      {
        type: "element",
        tag: "span",
        className: "cm-rendered-link",
        href: "https://example.test",
        children: [{ type: "text", text: "link" }],
      },
      { type: "text", text: " " },
      { type: "element", tag: "s", children: [{ type: "text", text: "gone" }] },
      { type: "text", text: " & < |" },
    ]);
  });

  test("parses Obsidian wiki links with table-escaped aliases in preview cells", () => {
    expect(parseTableCellInlineMarkdown("[[Format your notes\\|Formatting]]")).toEqual([
      {
        type: "element",
        tag: "span",
        className: "cm-wiki-link",
        wikiTarget: "Format your notes\\|Formatting",
        children: [{ type: "text", text: "Formatting" }],
      },
    ]);
  });

  test("parses table-cell wiki links inside other inline markdown", () => {
    expect(parseTableCellInlineMarkdown("**[[Roadmap]]**")).toEqual([
      {
        type: "element",
        tag: "strong",
        children: [
          {
            type: "element",
            tag: "span",
            className: "cm-wiki-link",
            wikiTarget: "Roadmap",
            children: [{ type: "text", text: "Roadmap" }],
          },
        ],
      },
    ]);
  });

  test("keeps inline html in table cells as text", () => {
    expect(parseTableCellInlineMarkdown("<img src=x onerror=alert(1)> **safe**")).toEqual([
      { type: "text", text: "<img src=x onerror=alert(1)> " },
      { type: "element", tag: "strong", children: [{ type: "text", text: "safe" }] },
    ]);
  });

  test("folds a table to the rendered preview when selection is outside", () => {
    const decorations = collectFoldDecorations(makeState(0));

    expect(decorations).toContainEqual(
      expect.objectContaining({ from: tableFrom, to: tableTo, hasWidget: true }),
    );
    expect(decorations.some((d) => d.className.includes("cm-table-source-line"))).toBe(false);
  });

  test("unfolds a touched table as codeblock-styled source lines", () => {
    const decorations = collectFoldDecorations(makeState(tableFrom + 2));
    const sourceLines = decorations.filter((d) => d.className.includes("cm-table-source-line"));

    expect(sourceLines).toHaveLength(3);
    expect(sourceLines[0]).toEqual(
      expect.objectContaining({
        from: tableFrom,
        to: tableFrom,
        className: expect.stringContaining("cm-table-source-line-first"),
        hasWidget: false,
      }),
    );
    expect(sourceLines[2]?.className).toContain("cm-table-source-line-last");
    expect(decorations.some((d) => d.from === tableFrom && d.to === tableTo && d.hasWidget)).toBe(
      false,
    );
  });

  test("range-selecting the whole table keeps source decorations instead of dropping the fold", () => {
    const decorations = collectFoldDecorations(makeState(tableTo, tableFrom));

    expect(decorations.length).toBeGreaterThan(0);
    expect(decorations.every((d) => !d.hasWidget)).toBe(true);
    expect(decorations.filter((d) => d.className.includes("cm-table-source-line"))).toHaveLength(3);
  });
});
