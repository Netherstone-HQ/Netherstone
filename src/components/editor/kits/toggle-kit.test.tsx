// @vitest-environment jsdom
import { TogglePlugin } from "@platejs/toggle/react";
import { createPlateEditor } from "platejs/react";
import { KEYS, type TElement, type Value } from "platejs";
import { describe, expect, it } from "vitest";
import { insertBlock, setBlockType } from "@/components/transforms";
import { EditorKit } from "@/components/editor/editor-kit";
import { hasToggles } from "@/components/editor/kits/toggle-kit";

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

describe("a shard knows whether it has toggles", () => {
  const paragraph = (text: string) => ({ type: KEYS.p, children: [{ text }] });
  const toggle = (text: string) => ({ type: KEYS.toggle, children: [{ text }] });

  it("as toggles are added, removed, split and merged", () => {
    const editor = createEditor([paragraph("one"), paragraph("two")]);
    expect(hasToggles(editor)).toBe(false);

    setBlockType(editor, KEYS.toggle);
    expect(hasToggles(editor)).toBe(true);

    editor.tf.splitNodes({ at: { path: [0, 0], offset: 1 }, always: true });
    editor.tf.removeNodes({ at: [0] });
    expect(hasToggles(editor)).toBe(true);

    editor.tf.withNewBatch(() => {
      editor.tf.insertNodes(paragraph("zero"), { at: [0] });
      editor.tf.mergeNodes({ at: [1] });
    });
    expect(hasToggles(editor)).toBe(false);

    editor.undo();
    expect(hasToggles(editor)).toBe(true);
  });

  it("when the whole shard is replaced", () => {
    const editor = createEditor([toggle("title")]);
    expect(hasToggles(editor)).toBe(true);

    editor.tf.setValue([paragraph("plain")]);
    expect(hasToggles(editor)).toBe(false);

    editor.tf.setValue([paragraph("a"), toggle("b")]);
    expect(hasToggles(editor)).toBe(true);
  });
});
