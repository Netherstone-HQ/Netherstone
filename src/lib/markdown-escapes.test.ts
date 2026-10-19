import { describe, expect, it } from "vitest";

import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";

const paragraph = (text: string) => [{ type: "p", children: [{ text }] }];

describe("escaping", () => {
  it.each([
    ["underscores inside words", "snake_case_name and file_name.md"],
    ["an ampersand that isn't an entity", "AT&T and R&D"],
    ["a star between spaces", "2 * 3 * 4"],
  ])("leaves %s as typed", (_name, text) => {
    const saved = saveValue(paragraph(text));
    expect(saved).toBe(`${text}\n`);
    expect(loadMarkdown(saved)[0].children).toEqual([{ text }]);
  });

  it.each([
    ["emphasis underscores", "_word_", "\\_word\\_"],
    ["a word ending in an underscore", "end_", "end\\_"],
    ["an entity", "&copy; and &#169;", "\\&copy; and \\&#169;"],
    ["a star that could start a list", "* not a list", "\\* not a list"],
    ["stars next to words", "5*3*2", "5\\*3\\*2"],
  ])("still escapes %s", (_name, text, expected) => {
    const saved = saveValue(paragraph(text));
    expect(saved).toBe(`${expected}\n`);
    expect(loadMarkdown(saved)[0].children).toEqual([{ text }]);
  });

  it("keeps a typed backslash", () => {
    const text = "a\\_b and path\\to_file";
    expect(loadMarkdown(saveValue(paragraph(text)))[0].children).toEqual([{ text }]);
  });

  it("writes hand-written files back unchanged", () => {
    const markdown = "Use snake_case for AT&T files, 2 * 3.\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });
});
