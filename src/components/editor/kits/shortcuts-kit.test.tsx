// @vitest-environment jsdom
import { KEYS, type Value } from "platejs";
import { createPlateEditor, getEditorPlugin } from "platejs/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useSettingsStore } from "@/store/settings";
import { ShortcutsKit } from "./shortcuts-kit";

const CODES: Record<string, [key: string, code: string]> = {
  period: [".", "Period"],
  comma: [",", "Comma"],
  enter: ["Enter", "Enter"],
};

/** A key press for keys like "mod+alt+1", on Windows or Linux. */
function pressFor(keys: string) {
  const parts = keys.split("+");
  const last = parts.pop()!;
  const [key, code] =
    CODES[last] ??
    (/^[0-9]$/.test(last) ? [last, `Digit${last}`] : [last, `Key${last.toUpperCase()}`]);
  return {
    key,
    code,
    ctrlKey: parts.includes("mod"),
    metaKey: false,
    altKey: parts.includes("alt"),
    shiftKey: parts.includes("shift"),
    preventDefault: vi.fn(),
  };
}

function createEditor(value: Value) {
  const editor = createPlateEditor({ plugins: EditorKit, value });
  editor.tf.select({ anchor: editor.api.start([0])!, focus: editor.api.end([0])! });
  const plugin = editor.getPlugin(ShortcutsKit[0]);
  const press = (keys: string) => {
    const event = pressFor(keys);
    const handled = plugin.handlers.onKeyDown!({
      ...getEditorPlugin(editor, plugin),
      event: event as never,
    });
    return { handled, prevented: event.preventDefault.mock.calls.length > 0 };
  };
  return { editor, press };
}

const paragraph = (text: string) => ({ type: KEYS.p, children: [{ text }] });

describe("editor shortcuts", () => {
  beforeEach(() => useSettingsStore.setState({ shortcuts: {} }));

  it("leave Plate's own key handling off, so the shortcut list is the only one", () => {
    const { editor } = createEditor([paragraph("text")]);
    expect(editor.meta.shortcuts).toEqual({});
  });

  it("all run on their default keys", () => {
    const changeable = SHORTCUTS.filter(
      (s) => s.scope === "editor" && !("fixed" in s),
    );
    for (const shortcut of changeable) {
      const { editor, press } = createEditor([paragraph("text")]);
      // A new line goes next to the caret, not a selection.
      if (shortcut.group === "blocks") editor.tf.collapse({ edge: "end" });
      const before = JSON.stringify([editor.children, editor.api.marks()]);
      expect(press(shortcut.keys[0]), shortcut.id).toEqual({ handled: true, prevented: true });
      const after = JSON.stringify([editor.children, editor.api.marks()]);
      // A paragraph is already a paragraph.
      if (shortcut.id !== "paragraph") expect(after, shortcut.id).not.toBe(before);
    }
  });

  it("turn a heading back into a paragraph", () => {
    const { editor, press } = createEditor([{ type: KEYS.h2, children: [{ text: "Title" }] }]);
    press("mod+alt+0");
    expect(editor.children[0]).toMatchObject({ type: KEYS.p });
  });

  it("follow keys changed in Settings", () => {
    useSettingsStore.setState({ shortcuts: { bold: ["mod+alt+b"] } });
    const { editor, press } = createEditor([paragraph("text")]);
    expect(press("mod+b").handled).toBeUndefined();
    expect(press("mod+alt+b").handled).toBe(true);
    expect(editor.api.marks()).toMatchObject({ bold: true });
  });
});
