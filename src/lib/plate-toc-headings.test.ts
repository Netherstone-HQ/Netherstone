// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS } from "platejs";
import { describe, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";
import { changesHeadings } from "./plate-toc-headings";

function createEditor() {
  return createPlateEditor({
    plugins: EditorKit,
    value: [
      { type: KEYS.h2, children: [{ text: "Title" }] },
      { type: KEYS.p, children: [{ text: "Body" }] },
    ],
  });
}

describe("changesHeadings", () => {
  it("is true while typing in a heading", () => {
    const editor = createEditor();
    editor.tf.insertText("!", { at: editor.api.end([0])! });

    expect(changesHeadings(editor)).toBe(true);
  });

  it("is false while typing in a paragraph", () => {
    const editor = createEditor();
    editor.tf.insertText("!", { at: editor.api.end([1])! });

    expect(changesHeadings(editor)).toBe(false);
  });

  it("is true when a block changes type", () => {
    const editor = createEditor();
    editor.tf.setNodes({ type: KEYS.h3 }, { at: [1] });

    expect(changesHeadings(editor)).toBe(true);
  });
});
