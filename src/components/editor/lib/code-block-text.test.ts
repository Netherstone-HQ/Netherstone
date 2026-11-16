import { KEYS, type TCodeBlockElement } from "platejs";
import { describe, expect, it } from "vitest";
import { loadMarkdown } from "@/test/markdown";
import { codeBlockText } from "./code-block-text";

const PYTHON = [
  "def greet(names):",
  "    for name in names:",
  "        if name:",
  "            print(f\"Hi {name}\")  ",
  "",
  "\tlegacy = True",
  "    ",
  "        # nested comment",
  "    return None",
].join("\n");

const fromMarkdown = (code: string, lang = "python") =>
  loadMarkdown(`\`\`\`${lang}\n${code}\n\`\`\`\n`).find(
    (node) => node.type === KEYS.codeBlock,
  ) as TCodeBlockElement;

describe("codeBlockText", () => {
  it("copies Python exactly: indentation, tabs, blank and trailing spaces", () => {
    expect(codeBlockText(fromMarkdown(PYTHON))).toBe(PYTHON);
  });

  it("copies a plain text template line by line", () => {
    const template =
      'Task:\n${task}\n\nFeedback on your previous answer ("none" means this is the first attempt):\n${previousError}\n\n${runTag}';

    expect(codeBlockText(fromMarkdown(template, "plaintext"))).toBe(template);
  });

  it("joins a line split into several leaves", () => {
    const element: TCodeBlockElement = {
      type: KEYS.codeBlock,
      children: [
        { type: KEYS.codeLine, children: [{ text: "  const " }, { text: "a = 1;" }] },
        { type: KEYS.codeLine, children: [{ text: "" }] },
      ],
    };

    expect(codeBlockText(element)).toBe("  const a = 1;\n");
  });
});
