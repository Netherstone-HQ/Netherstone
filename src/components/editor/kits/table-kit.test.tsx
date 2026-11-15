// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS, type Descendant, type Path, type TElement } from "platejs";
import { describe, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";

const p = (text: string, props = {}) => ({ type: KEYS.p, ...props, children: [{ text }] });
const cell = (type: string, ...blocks: Descendant[]) => ({ type, children: blocks });

/** "Top", a 2x2 table whose first cell holds `first`, then "End" (and the trailing empty line). */
function createEditor(first: Descendant[] = [p("alpha")]) {
  return createPlateEditor({
    plugins: EditorKit,
    value: [
      p("Top"),
      {
        type: KEYS.table,
        children: [
          { type: KEYS.tr, children: [cell(KEYS.th, ...first), cell(KEYS.th, p("bravo"))] },
          { type: KEYS.tr, children: [cell(KEYS.td, p("a")), cell(KEYS.td, p("b"))] },
        ],
      },
      p("End"),
    ] as never,
  });
}
type Editor = ReturnType<typeof createEditor>;

/** Each top-level block as text; the table as its cells' block texts. */
function shape(editor: Editor) {
  return (editor.children as TElement[]).map((node) =>
    node.type === KEYS.table
      ? (node.children as TElement[]).map((row) =>
          (row.children as TElement[]).map((c) =>
            (c.children as TElement[]).map((block) => `${block.type}: ${editor.api.string(block as never)}`),
          ),
        )
      : editor.api.string(node as never),
  );
}

const UNCHANGED = [
  "Top",
  [
    [["p: alpha"], ["p: bravo"]],
    [["p: a"], ["p: b"]],
  ],
  "End",
  "",
];

function backspaceAt(editor: Editor, path: Path, unit: "character" | "word" = "character") {
  editor.tf.select(editor.api.start(path)!);
  editor.tf.deleteBackward(unit);
}

describe("deleting at a table cell's edge", () => {
  it("Backspace at the first cell's start leaves the block above alone", () => {
    const editor = createEditor();
    backspaceAt(editor, [1, 0, 0]);
    expect(shape(editor)).toEqual(UNCHANGED);
  });

  it("Backspace with Ctrl at the first cell's start leaves the block above alone", () => {
    const editor = createEditor();
    backspaceAt(editor, [1, 0, 0], "word");
    expect(shape(editor)).toEqual(UNCHANGED);
  });

  it("Backspace at a later cell's start leaves the cell before alone", () => {
    const editor = createEditor();
    backspaceAt(editor, [1, 0, 1]);
    expect(shape(editor)).toEqual(UNCHANGED);
  });

  it("Delete at the end of a row's last cell leaves the next row alone", () => {
    const editor = createEditor();
    editor.tf.select(editor.api.end([1, 0, 1])!);
    editor.tf.deleteForward("character");
    expect(shape(editor)).toEqual(UNCHANGED);
  });

  it("Delete before the table moves into it instead of merging", () => {
    const editor = createEditor();
    editor.tf.select(editor.api.end([0])!);
    editor.tf.deleteForward("character");
    expect(shape(editor)).toEqual(UNCHANGED);
    expect(editor.selection?.anchor).toEqual(editor.api.start([1, 0, 0]));
  });

  it("Backspace after the table moves into it instead of merging", () => {
    const editor = createEditor();
    backspaceAt(editor, [2]);
    expect(shape(editor)).toEqual(UNCHANGED);
    expect(editor.selection?.anchor).toEqual(editor.api.end([1, 1, 1]));
  });

  it("Backspace still deletes inside a cell", () => {
    const editor = createEditor();
    editor.tf.select({ path: [1, 0, 0, 0, 0], offset: 2 });
    editor.tf.deleteBackward("character");
    expect(shape(editor)[1]).toEqual([
      [["p: apha"], ["p: bravo"]],
      [["p: a"], ["p: b"]],
    ]);
  });

  it("Backspace still joins two blocks in one cell", () => {
    const editor = createEditor([p("alpha"), p("two")]);
    backspaceAt(editor, [1, 0, 0, 1]);
    expect(shape(editor)[1]).toEqual([
      [["p: alphatwo"], ["p: bravo"]],
      [["p: a"], ["p: b"]],
    ]);
  });

  it("Backspace still turns a heading at a cell's start into a paragraph", () => {
    const editor = createEditor([{ type: KEYS.h2, children: [{ text: "head" }] } as never]);
    backspaceAt(editor, [1, 0, 0]);
    expect(shape(editor)[1]).toEqual([
      [["p: head"], ["p: bravo"]],
      [["p: a"], ["p: b"]],
    ]);
  });

  it("Backspace still ends a list item at a cell's start", () => {
    const editor = createEditor([p("item", { listStyleType: "disc", indent: 1 })]);
    backspaceAt(editor, [1, 0, 0]);
    const block = editor.api.node([1, 0, 0, 0])![0] as TElement;
    expect(block.listStyleType).toBeUndefined();
    expect(editor.api.string([1, 0, 0])).toBe("item");
  });

  it("deleting a selection across cells still works", () => {
    const editor = createEditor();
    editor.tf.select({ anchor: { path: [1, 0, 0, 0, 0], offset: 2 }, focus: { path: [1, 0, 0, 0, 0], offset: 5 } });
    editor.tf.deleteFragment();
    expect(editor.api.string([1, 0, 0])).toBe("al");
  });
});
