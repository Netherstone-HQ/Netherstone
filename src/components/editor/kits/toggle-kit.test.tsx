// @vitest-environment jsdom
import { TogglePlugin } from "@platejs/toggle/react";
import { createPlateEditor } from "platejs/react";
import { KEYS, type TElement, type Value } from "platejs";
import { describe, expect, it } from "vitest";
import { insertBlock, setBlockType } from "@/components/transforms";
import { EditorKit } from "@/components/editor/editor-kit";

function createEditor(value: Value) {
  // Ids are off in tests by default, and toggles are opened by id.
  const editor = createPlateEditor({ plugins: EditorKit, value, nodeId: true });
  editor.tf.select(editor.api.start([0])!);
  return editor;
}

function openToggles(editor: ReturnType<typeof createEditor>) {
  const openIds = editor.getOption(TogglePlugin, "openIds");
  return (editor.children as TElement[])
    .filter((node) => node.type === KEYS.toggle)
    .map((node) => openIds?.has(node.id as string) ?? false);
}

describe("new toggles start open", () => {
  it("when inserted from the slash or insert menu", () => {
    const editor = createEditor([{ type: KEYS.p, children: [{ text: "" }] }]);
    insertBlock(editor, KEYS.toggle);
    expect(openToggles(editor)).toEqual([true]);
  });

  it("when a block is turned into one", () => {
    const editor = createEditor([{ type: KEYS.p, children: [{ text: "title" }] }]);
    setBlockType(editor, KEYS.toggle);
    expect(openToggles(editor)).toEqual([true]);
  });

  it("when Enter at the end of a closed toggle starts the next one", () => {
    const editor = createEditor([{ type: KEYS.toggle, children: [{ text: "title" }] }]);
    editor.tf.select(editor.api.end([0])!);
    editor.tf.insertBreak();
    expect(openToggles(editor)).toEqual([false, true]);
  });

  it("but toggles loaded from a file stay closed", () => {
    const editor = createEditor([
      { type: KEYS.toggle, children: [{ text: "title" }] },
      { type: KEYS.p, indent: 1, children: [{ text: "body" }] },
    ]);
    expect(openToggles(editor)).toEqual([false]);
  });
});
