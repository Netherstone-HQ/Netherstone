// @vitest-environment jsdom
import { createPlateEditor } from "platejs/react";
import { KEYS, type Value } from "platejs";
import { describe, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";

function type(text: string, value: Value = [{ type: KEYS.p, children: [{ text: "" }] }]) {
  const editor = createPlateEditor({ plugins: EditorKit, value });
  editor.tf.select(editor.api.end([0]));
  for (const char of text) editor.tf.insertText(char);
  return editor;
}

const typed = (text: string, value?: Value) => type(text, value).api.string([0]);

describe("fractions", () => {
  it("turn into a fraction once the number ends", () => {
    expect(typed("1/2 cup")).toBe("½ cup");
    expect(typed("add 3/4, then (1/10)")).toBe("add ¾, then (⅒)");
  });

  it("stay as typed inside dates and longer numbers", () => {
    expect(typed("on 1/2/2026 ")).toBe("on 1/2/2026 ");
    expect(typed("1/25 ")).toBe("1/25 ");
    expect(typed("11/2 ")).toBe("11/2 ");
    expect(typed("12/1/2 ")).toBe("12/1/2 ");
    expect(typed("v1/2 ")).toBe("v1/2 ");
  });
});

describe("comparisons and arrows", () => {
  it("turn <= into less than or equal, and <== into the arrow", () => {
    expect(typed("a <= b")).toBe("a ≤ b");
    expect(typed("a <== b")).toBe("a ⇐ b");
    expect(typed("a >= b")).toBe("a ≥ b");
    expect(typed("a => b")).toBe("a ⇒ b");
  });

  it("reach the negated forms", () => {
    expect(typed("a !<= b")).toBe("a ≰ b");
    expect(typed("a !>= b")).toBe("a ≱ b");
    expect(typed("a !~= b")).toBe("a ≉ b");
    expect(typed("a ~= b")).toBe("a ≈ b");
  });
});

describe("inline code", () => {
  it("keeps what is typed in it as is", () => {
    const editor = type('"x" -> 1/2 ', [
      { type: KEYS.p, children: [{ text: "run " }, { text: "a", [KEYS.code]: true }] },
    ]);
    expect(editor.api.string([0])).toBe('run a"x" -> 1/2 ');
  });

  it("does not stop replacements outside it", () => {
    expect(typed('say "hi" ')).toBe("say “hi” ");
  });
});
