// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";

import { EditorKit } from "@/components/editor/editor-kit";
import { SerializationKit } from "@/components/editor/serialization-kit";
import { loadMarkdown, saveValue } from "@/test/markdown";
import { columnAlignAt, setColumnAlign } from "./table-align";

const TABLE =
  "| Item | Count | Note |\n| --- | --- | --- |\n| drawing | 482 | list bridge |\n| archive | 813 | bridge sync |\n";

function editorWithCaretIn(row: number, col: number) {
  const editor = createPlateEditor({
    plugins: EditorKit,
    value: loadMarkdown(TABLE),
  });
  editor.tf.select({ path: [0, row, col, 0, 0], offset: 0 });
  return editor;
}

describe("column alignment", () => {
  it("aligns the whole column of the cell holding the caret, and saves it", () => {
    const editor = editorWithCaretIn(2, 1);
    expect(columnAlignAt(editor)).toBe("left");

    setColumnAlign(editor, "right");

    expect(columnAlignAt(editor)).toBe("right");
    const markdown = saveValue(editor.children, SerializationKit);
    expect(markdown).toMatch(/\| :?-+ \| -+: \| :?-+ \|/);
  });

  it("reads back the alignment a saved table has", () => {
    const editor = createPlateEditor({
      plugins: EditorKit,
      value: loadMarkdown("| A | B |\n| --- | :---: |\n| 1 | 2 |\n"),
    });
    editor.tf.select({ path: [0, 1, 1, 0, 0], offset: 0 });
    expect(columnAlignAt(editor)).toBe("center");
  });
});
