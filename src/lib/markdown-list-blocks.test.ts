import { describe, expect, it } from "vitest";

import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";

describe("blocks inside list items", () => {
  it.each([
    ["a paragraph", "- item\n\n  More about the item.\n- next\n"],
    ["a code block", "- item\n\n  ```js\n  x()\n  ```\n"],
    ["a quote", "- item\n\n  > quoted\n- next\n"],
    ["a heading", "- item\n\n  ## Heading\n"],
    ["a numbered item's paragraph", "1. one\n\n   More of one.\n2. two\n"],
    ["a nested item's paragraph", "- a\n  - b\n\n    More of b.\n"],
    ["a paragraph before a nested list", "- a\n\n  More of a.\n\n  - b\n- c\n"],
    ["a to-do's notes", "- [ ] task\n\n  Notes.\n- [x] done\n"],
    ["a list that changes style after one", "- a\n\n  More.\n\n1. one\n"],
    ["a list inside a toggle", "<details>\n<summary>T</summary>\n\n- a\n\n  More.\n\n</details>\n"],
  ])("keeps %s in its item", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("loads them one indent past their item", () => {
    const [item, block] = loadMarkdown("- item\n\n  More.\n");
    expect(item).toMatchObject({ listStyleType: "disc", indent: 1 });
    expect(block).toMatchObject({ type: "p", indent: 2 });
    expect(block.listStyleType).toBeUndefined();
  });

  it("saves an indented block typed under an item inside it", () => {
    const saved = saveValue([
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "item" }] },
      { type: "p", indent: 2, children: [{ text: "More." }] },
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "next" }] },
    ]);
    expect(saved).toBe("- item\n\n  More.\n- next\n");
  });

  it("leaves a block that isn't under an item where it was", () => {
    const markdown = '- a\n\n<div style="margin-left: 24px">\n\nindented\n\n</div>\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("leaves a centred block after an item outside the list", () => {
    const saved = saveValue([
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "item" }] },
      { type: "p", indent: 2, align: "center", children: [{ text: "centred" }] },
    ]);
    expect(saved).toBe(
      '- item\n\n<div align="center" style="margin-left: 48px">\n\ncentred\n\n</div>\n',
    );
  });
});
