// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS } from "platejs";
import { describe, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";
import { findTag } from "./link-reveal";

describe("findTag", () => {
  it("finds a tag as a word, outside code", () => {
    const editor = createPlateEditor({
      plugins: EditorKit,
      value: [
        { type: KEYS.codeBlock, children: [{ type: KEYS.codeLine, children: [{ text: "#ideas" }] }] },
        { type: KEYS.p, children: [{ text: "#ideas", code: true }] },
        { type: KEYS.p, children: [{ text: "Not #ideasmore, but #ideas." }] },
      ],
    });

    expect(findTag(editor, "ideas")).toEqual({
      anchor: { path: [2, 0], offset: 20 },
      focus: { path: [2, 0], offset: 26 },
    });
    expect(findTag(editor, "missing")).toBeUndefined();
  });
});
