import { describe, expect, it } from "vitest";
import {
  countTags,
  findTag,
  formatModified,
  matchesTagFilter,
  splitAtTag,
  toPlainLine,
  type TaggedFile,
} from "./tags";

const file = (name: string, ...tags: string[]): TaggedFile => ({
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  last_modified: 0,
  tags: tags.map((tag) => ({ tag, line: null })),
});

describe("countTags", () => {
  it("counts shards per tag, most used first, then by name", () => {
    const files = [
      file("a", "todo", "ideas"),
      file("b", "ideas"),
      file("c", "art"),
    ];
    expect(countTags(files)).toEqual([
      { tag: "ideas", count: 2 },
      { tag: "art", count: 1 },
      { tag: "todo", count: 1 },
    ]);
  });
});

describe("matchesTagFilter", () => {
  it("ignores case, spaces and a leading #", () => {
    expect(matchesTagFilter("Reading", " #read")).toBe(true);
    expect(matchesTagFilter("ideas", "")).toBe(true);
    expect(matchesTagFilter("ideas", "todo")).toBe(false);
  });
});

describe("findTag", () => {
  it("finds whole tags only", () => {
    expect(findTag("Plans #ideas", "ideas")).toBe(6);
    expect(findTag("#ideas-old #ideas.", "ideas")).toBe(11);
    expect(findTag("#ideasbook", "ideas")).toBe(-1);
    expect(findTag("issue#ideas", "ideas")).toBe(-1);
  });
});

describe("toPlainLine", () => {
  it("drops Markdown syntax but keeps the words", () => {
    expect(toPlainLine("- [ ] Call **Sam** about #todo")).toBe(
      "Call Sam about #todo",
    );
    expect(toPlainLine("## Plans #ideas")).toBe("Plans #ideas");
    expect(
      toPlainLine("> See [Reading list](mention:Reading%20list.md) #books"),
    ).toBe("See Reading list #books");
    expect(toPlainLine("A <mark>bright</mark> _idea_ in `code` \\#not")).toBe(
      "A bright idea in code #not",
    );
  });

  it("keeps underscores inside words", () => {
    expect(toPlainLine("snake_case_name #code")).toBe("snake_case_name #code");
  });
});

describe("splitAtTag", () => {
  it("splits the line around the tag", () => {
    expect(splitAtTag("1. Finish the draft #todo today", "todo")).toEqual({
      before: "Finish the draft ",
      match: "#todo",
      after: " today",
    });
  });

  it("shortens a long lead to the words nearest the tag", () => {
    const lead = "word ".repeat(30);
    const { before } = splitAtTag(`${lead}#ideas`, "ideas");
    expect(before.startsWith("…word")).toBe(true);
    expect(before.length).toBeLessThanOrEqual(61);
  });

  it("returns the plain line when the tag can't be found", () => {
    expect(splitAtTag("**Just text**", "ideas")).toEqual({
      before: "Just text",
      match: null,
      after: "",
    });
  });
});

describe("formatModified", () => {
  const now = new Date(2026, 9, 16, 15, 0);
  const at = (...parts: [number, number, number, number?]) =>
    new Date(...(parts as [number, number, number, number])).getTime() / 1000;

  it("names today and yesterday, then dates", () => {
    expect(formatModified(at(2026, 9, 16, 1), now, "en-US")).toBe("Today");
    expect(formatModified(at(2026, 9, 15, 23), now, "en-US")).toBe("Yesterday");
    expect(formatModified(at(2026, 9, 11, 9), now, "en-US")).toBe("Oct 11");
    expect(formatModified(at(2025, 7, 2, 9), now, "en-US")).toBe("Aug 2, 2025");
  });
});
