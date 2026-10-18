import { describe, expect, it } from "vitest";
import {
  applyBlockFormatting,
  blockFormattingOf,
  formattingOpeningTag,
  parseFormattingOpeningTag,
  wrapFormattedBlocks,
} from "@/lib/markdown-block-formatting";
import { createRawBlockNode } from "@/lib/markdown-raw-blocks";

const p = (text: string, extra: object = {}) => ({
  type: "p",
  children: [{ text }],
  ...extra,
});

describe("block formatting", () => {
  it("reads alignment, line height and indent off a block, not a list item's indent", () => {
    expect(blockFormattingOf(p("a", { align: "center", lineHeight: 2, indent: 1 }))).toEqual({
      align: "center",
      lineHeight: 2,
      indent: 1,
    });
    expect(blockFormattingOf(p("a", { align: "start", lineHeight: 1.5 }))).toBeNull();
    expect(blockFormattingOf(p("a", { indent: 2, listStyleType: "disc" }))).toBeNull();
    expect(blockFormattingOf({ type: "hr", align: "center", children: [{ text: "" }] })).toBeNull();
  });

  it("writes one tag for the formatting and reads it back", () => {
    const formatting = { align: "right", lineHeight: 2, indent: 2 };
    const tag = formattingOpeningTag(formatting);
    expect(tag).toBe('<div align="right" style="line-height: 2; margin-left: 48px">');
    expect(parseFormattingOpeningTag(tag)).toEqual(formatting);
    expect(parseFormattingOpeningTag('<div style="text-align: center">')).toEqual({
      align: "center",
    });
    expect(parseFormattingOpeningTag('<div style="padding-left: 30px">')).toEqual({ indent: 1 });
  });

  it("leaves a div it has no setting for alone", () => {
    expect(parseFormattingOpeningTag('<div class="note">')).toBeNull();
    expect(parseFormattingOpeningTag('<div align="center" class="x">')).toBeNull();
    expect(parseFormattingOpeningTag('<div style="color: red">')).toBeNull();
    expect(parseFormattingOpeningTag('<div align="middle">')).toBeNull();
    expect(parseFormattingOpeningTag("<div>")).toBeNull();
    expect(parseFormattingOpeningTag('<div align="center">text</div>')).toBeNull();
  });

  it("wraps runs of blocks sharing formatting and takes it off the blocks", () => {
    const value = [
      p("a", { align: "center" }),
      { type: "h2", align: "center", children: [{ text: "b" }] },
      p("c", { align: "center", indent: 1 }),
      p("d"),
      p("e", { lineHeight: 2 }),
    ];
    expect(wrapFormattedBlocks(value)).toEqual([
      createRawBlockNode('<div align="center">'),
      p("a"),
      { type: "h2", children: [{ text: "b" }] },
      createRawBlockNode("</div>"),
      createRawBlockNode('<div align="center" style="margin-left: 24px">'),
      p("c"),
      createRawBlockNode("</div>"),
      p("d"),
      createRawBlockNode('<div style="line-height: 2">'),
      p("e"),
      createRawBlockNode("</div>"),
    ]);
    expect(wrapFormattedBlocks([p("a"), p("b")])).toEqual([p("a"), p("b")]);
  });

  it("puts a wrapper's formatting back on the blocks inside it", () => {
    const value = [
      createRawBlockNode('<div align="center">'),
      p("a"),
      { type: "h2", children: [{ text: "b" }] },
      createRawBlockNode("</div>"),
      p("c"),
    ];
    expect(applyBlockFormatting(value)).toEqual([
      p("a", { align: "center" }),
      { type: "h2", children: [{ text: "b" }], align: "center" },
      p("c"),
    ]);
  });

  it("keeps a wrapper whose content can't carry the formatting, or that never closes", () => {
    const list = [
      createRawBlockNode('<div align="center">'),
      p("a", { listStyleType: "disc", indent: 1 }),
      createRawBlockNode("</div>"),
    ];
    expect(applyBlockFormatting(list)).toBe(list);

    const nested = [
      createRawBlockNode('<div align="center">'),
      createRawBlockNode('<div class="x">'),
      p("a"),
      createRawBlockNode("</div>"),
      createRawBlockNode("</div>"),
    ];
    expect(applyBlockFormatting(nested)).toBe(nested);

    const open = [createRawBlockNode('<div align="center">'), p("a")];
    expect(applyBlockFormatting(open)).toBe(open);

    const empty = [createRawBlockNode('<div align="center">'), createRawBlockNode("</div>")];
    expect(applyBlockFormatting(empty)).toBe(empty);
  });

  it("wraps inside a quote and a gathered toggle, not inside a table cell", () => {
    const cell = {
      type: "td",
      children: [p("c", { align: "center" })],
    };
    const value = [
      { type: "blockquote", children: [p("q", { indent: 1 })] },
      { type: "toggle", children: [{ text: "t" }], body: [p("in", { align: "center" })] },
      { type: "table", children: [{ type: "tr", children: [cell] }] },
    ];
    expect(wrapFormattedBlocks(value)).toEqual([
      {
        type: "blockquote",
        children: [
          createRawBlockNode('<div style="margin-left: 24px">'),
          p("q"),
          createRawBlockNode("</div>"),
        ],
      },
      {
        type: "toggle",
        children: [{ text: "t" }],
        body: [createRawBlockNode('<div align="center">'), p("in"), createRawBlockNode("</div>")],
      },
      { type: "table", children: [{ type: "tr", children: [cell] }] },
    ]);
  });

  it("adds a wrapper's indent to the indent a toggle already gave a block", () => {
    const value = [
      createRawBlockNode('<div style="margin-left: 24px">'),
      p("a", { indent: 1 }),
      createRawBlockNode("</div>"),
    ];
    expect(applyBlockFormatting(value)).toEqual([p("a", { indent: 2 })]);
  });

  it("reaches blocks inside a quote", () => {
    const value = [
      {
        type: "blockquote",
        children: [
          createRawBlockNode('<div style="margin-left: 24px">'),
          p("quoted"),
          createRawBlockNode("</div>"),
        ],
      },
    ];
    expect(applyBlockFormatting(value)).toEqual([
      { type: "blockquote", children: [p("quoted", { indent: 1 })] },
    ]);
  });
});
