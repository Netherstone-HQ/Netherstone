// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS, type Value } from "platejs";
import { describe, expect, it } from "vitest";
import { insertBlock, setBlockType } from "@/components/transforms";
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
