import { describe, expect, it } from "vitest";
import { groupToggles } from "@/lib/markdown-toggles";
import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";

const text = (t: string) => [{ text: t }];

describe("toggles", () => {
  it("saves a toggle and its content as a details block", () => {
    const saved = saveValue([
      { type: "toggle", children: [{ text: "Title " }, { text: "bold", bold: true }] },
      { type: "p", indent: 1, children: text("Inside") },
      { type: "p", indent: 2, listStyleType: "disc", children: text("item") },
      { type: "p", children: text("Outside") },
    ]);
    expect(saved).toBe(
      "<details>\n<summary>Title <b>bold</b></summary>\n\nInside\n\n- item\n\n</details>\n\nOutside\n",
    );
  });

  it("loads a details block back as a toggle with indented content", () => {
    const value = loadMarkdown(
      "<details>\n<summary>Title</summary>\n\nInside\n\n- item\n\n</details>\n\nOutside\n",
    );
    expect(value.map((n) => [n.type, n.indent, n.listStyleType])).toEqual([
      ["toggle", undefined, undefined],
      ["p", 1, undefined],
      ["p", 2, "disc"],
      ["p", undefined, undefined],
    ]);
  });

  it("nests toggles", () => {
    const markdown =
      "<details>\n<summary>Outer</summary>\n\nA\n\n<details>\n<summary>Inner</summary>\n\nB\n\n</details>\n\n</details>\n";
    const value = loadMarkdown(markdown);
    expect(value.map((n) => [n.type, n.indent])).toEqual([
      ["toggle", undefined],
      ["p", 1],
      ["toggle", 1],
      ["p", 2],
    ]);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("escapes HTML in the title and keeps the content indent relative", () => {
    const saved = saveValue([
      { type: "toggle", indent: 1, children: text("a < b & c") },
      { type: "p", indent: 2, children: text("Inside") },
    ]);
    expect(saved).toContain("<summary>a &lt; b &amp; c</summary>");
    expect(saved).toContain("\n\nInside\n\n</details>");
  });

  it("groups only the blocks that belong to the toggle", () => {
    const grouped = groupToggles([
      { type: "toggle", children: text("T") },
      { type: "p", indent: 1, children: text("in") },
      { type: "p", indent: 1, listStyleType: "disc", children: text("top-level list, not inside") },
    ]) as any[];
    expect(grouped).toHaveLength(2);
    expect(grouped[0].body).toEqual([{ type: "p", children: text("in") }]);
  });
});
