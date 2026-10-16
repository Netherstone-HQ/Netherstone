import { describe, expect, it } from "vitest";
import {
  countTags,
  formatModified,
  matchesTagFilter,
  type TaggedFile,
} from "./tags";

const file = (name: string, ...tags: string[]): TaggedFile => ({
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  last_modified: 0,
  tags: tags.map((tag) => ({ tag, excerpt: null })),
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
