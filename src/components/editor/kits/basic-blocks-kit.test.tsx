// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS, type NodeEntry, type TElement, type Value } from "platejs";
import { describe, expect, it } from "vitest";
import { getTurnIntoBlocks, insertBlock, setBlockType } from "@/components/transforms";
import { EditorKit } from "@/components/editor/editor-kit";

function createEditor(value: Value) {
  return createPlateEditor({ plugins: EditorKit, value });
}

describe("quotes keep the caret", () => {
  it("in a quote inserted from the slash menu", () => {
    const editor = createEditor([
      { type: KEYS.p, children: [{ text: "before" }] },
      { type: KEYS.p, children: [{ text: "" }] },
      { type: KEYS.p, children: [{ text: "after" }] },
    ]);
    editor.tf.select(editor.api.start([1])!);

    insertBlock(editor, KEYS.blockquote);
    editor.tf.insertText("quoted");

    expect(editor.children.slice(0, 3)).toMatchObject([
      { type: KEYS.p, children: [{ text: "before" }] },
      { type: KEYS.blockquote, children: [{ type: KEYS.p, children: [{ text: "quoted" }] }] },
      { type: KEYS.p, children: [{ text: "after" }] },
    ]);
  });

  it("where it was when a paragraph is turned into a quote", () => {
    const editor = createEditor([
      { type: KEYS.p, children: [{ text: "before" }] },
      { type: KEYS.p, children: [{ text: "abcd" }] },
    ]);
    editor.tf.select({ path: [1, 0], offset: 2 });

    setBlockType(editor, KEYS.blockquote);

    expect(editor.children[1]).toMatchObject({
      type: KEYS.blockquote,
      children: [{ type: KEYS.p, children: [{ text: "abcd" }] }],
    });
    expect(editor.selection).toEqual({
      anchor: { path: [1, 0, 0], offset: 2 },
      focus: { path: [1, 0, 0], offset: 2 },
    });
  });

  it("wraps each run of loose text in its own paragraph", () => {
    const editor = createEditor([
      {
        type: KEYS.blockquote,
        children: [
          { text: "one" },
          { type: KEYS.p, children: [{ text: "two" }] },
          { text: "three" },
        ],
      },
    ]);
    editor.tf.normalize({ force: true });

    expect(editor.children[0]).toEqual({
      type: KEYS.blockquote,
      children: [
        { type: KEYS.p, children: [{ text: "one" }] },
        { type: KEYS.p, children: [{ text: "two" }] },
        { type: KEYS.p, children: [{ text: "three" }] },
      ],
    });
  });
});

describe("blocks from the slash menu in a list", () => {
  const list = () => [
    { type: KEYS.p, indent: 1, listStyleType: KEYS.ul, children: [{ text: "first" }] },
    { type: KEYS.p, indent: 1, listStyleType: KEYS.ul, children: [{ text: "" }] },
    { type: KEYS.p, indent: 1, listStyleType: KEYS.ul, children: [{ text: "second" }] },
  ];

  it("a code block from an empty item goes inside the item above", () => {
    const editor = createEditor(list());
    editor.tf.select(editor.api.start([1])!);

    insertBlock(editor, KEYS.codeBlock, { upsert: true });
    editor.tf.insertText("x = 1");

    expect(editor.children.slice(0, 3)).toMatchObject([
      { listStyleType: KEYS.ul, children: [{ text: "first" }] },
      {
        type: KEYS.codeBlock,
        indent: 2,
        children: [{ type: KEYS.codeLine, children: [{ text: "x = 1" }] }],
      },
      { listStyleType: KEYS.ul, children: [{ text: "second" }] },
    ]);
    expect(editor.children[1]).not.toHaveProperty("listStyleType");
    expect(editor.children[1].children[0]).not.toHaveProperty("listStyleType");
  });

  it("a quote from an item goes inside it", () => {
    const editor = createEditor(list());
    editor.tf.select(editor.api.end([0])!);

    insertBlock(editor, KEYS.blockquote, { upsert: true });

    expect(editor.children[1]).toMatchObject({ type: KEYS.blockquote, indent: 2 });
    expect(editor.children[1]).not.toHaveProperty("listStyleType");
  });

  it("a block from a block inside an item stays at its indent", () => {
    const editor = createEditor([
      { type: KEYS.p, indent: 1, listStyleType: KEYS.ul, children: [{ text: "item" }] },
      { type: KEYS.p, indent: 2, children: [{ text: "more" }] },
    ]);
    editor.tf.select(editor.api.end([1])!);

    insertBlock(editor, KEYS.codeBlock, { upsert: true });

    expect(editor.children[2]).toMatchObject({ type: KEYS.codeBlock, indent: 2 });
  });

  it("a table from an item is not put in the item", () => {
    const editor = createEditor(list());
    editor.tf.select(editor.api.end([0])!);

    insertBlock(editor, KEYS.table, { upsert: true });

    const table = editor.children.find((node) => node.type === KEYS.table);
    expect(table).not.toHaveProperty("indent");
  });
});

describe("Turn into", () => {
  const text = (value: string) => [{ text: value }];

  it("skips blocks that aren't text, like math", () => {
    const editor = createEditor([
      { type: KEYS.equation, texExpression: "x^2", children: text("") },
    ]);
    const entries = [[editor.children[0], [0]] as NodeEntry<TElement>];

    expect(getTurnIntoBlocks(editor, entries)).toHaveLength(0);
    setBlockType(editor, KEYS.blockquote, { entries });

    expect(editor.children[0]).toMatchObject({
      type: KEYS.equation,
      texExpression: "x^2",
    });
  });

  it("skips text in a table cell", () => {
    const editor = createEditor([
      {
        type: KEYS.table,
        children: [
          {
            type: KEYS.tr,
            children: [{ type: KEYS.td, children: [{ type: KEYS.p, children: text("cell") }] }],
          },
        ],
      },
    ]);
    editor.tf.select(editor.api.start([0, 0, 0, 0])!);

    expect(getTurnIntoBlocks(editor)).toHaveLength(0);
  });

  it("turns a code block's lines into headings", () => {
    const editor = createEditor([
      {
        type: KEYS.codeBlock,
        children: [
          { type: KEYS.codeLine, children: text("one") },
          { type: KEYS.codeLine, children: text("two") },
        ],
      },
    ]);
    editor.tf.select(editor.api.start([0, 1])!);

    setBlockType(editor, KEYS.h2);

    expect(editor.children.slice(0, 2)).toMatchObject([
      { type: KEYS.h2, children: text("one") },
      { type: KEYS.h2, children: text("two") },
    ]);
  });

  it("turns a quote back into text", () => {
    const editor = createEditor([
      { type: KEYS.blockquote, children: [{ type: KEYS.p, children: text("quoted") }] },
    ]);
    editor.tf.select(editor.api.start([0, 0])!);

    setBlockType(editor, KEYS.p);

    expect(editor.children[0]).toMatchObject({ type: KEYS.p, children: text("quoted") });
  });

  it("turns a code block into one quote with a paragraph per line", () => {
    const editor = createEditor([
      {
        type: KEYS.codeBlock,
        children: [
          { type: KEYS.codeLine, children: text("one") },
          { type: KEYS.codeLine, children: text("two") },
        ],
      },
    ]);
    editor.tf.select(editor.api.start([0, 0])!);

    setBlockType(editor, KEYS.blockquote);

    expect(editor.children[0]).toMatchObject({
      type: KEYS.blockquote,
      children: [
        { type: KEYS.p, children: text("one") },
        { type: KEYS.p, children: text("two") },
      ],
    });
  });

  it("moves a whole code block into three columns", () => {
    const editor = createEditor([
      {
        type: KEYS.codeBlock,
        children: [{ type: KEYS.codeLine, children: text("one") }],
      },
    ]);
    editor.tf.select(editor.api.start([0, 0])!);

    setBlockType(editor, "action_three_columns");

    expect(editor.children[0]).toMatchObject({
      type: KEYS.columnGroup,
      children: [
        { type: KEYS.column, children: [{ type: KEYS.codeBlock, children: [{ children: text("one") }] }] },
        { type: KEYS.column },
        { type: KEYS.column },
      ],
    });
  });

  it("keeps a code block inside a list item when its lines become text", () => {
    const editor = createEditor([
      { type: KEYS.p, indent: 1, listStyleType: KEYS.ul, children: text("item") },
      {
        type: KEYS.codeBlock,
        indent: 2,
        children: [{ type: KEYS.codeLine, children: text("one") }],
      },
    ]);
    editor.tf.select(editor.api.start([1, 0])!);

    setBlockType(editor, KEYS.p);

    expect(editor.children[1]).toMatchObject({ type: KEYS.p, indent: 2, children: text("one") });
  });
});
