import { describe, expect, it } from "vitest";
import { diffSequences, type Edit } from "./sequence-diff";

/** Applies `edits` to `a`, which must give `b`. */
function apply(a: string[], b: string[], edits: Edit[]) {
  return edits.flatMap((edit) =>
    edit.kind === "removed"
      ? []
      : edit.kind === "added"
        ? [b[edit.b]]
        : [a[edit.a]],
  );
}

const words = (text: string) => text.split(" ");

describe("diffSequences", () => {
  it("finds the fewest changes", () => {
    const a = words("the quick brown fox jumps");
    const b = words("the slow brown fox leaps high");
    const edits = diffSequences(a, b);
    expect(apply(a, b, edits)).toEqual(b);
    expect(edits.filter((edit) => edit.kind !== "equal")).toHaveLength(5);
  });

  it("puts what's removed before what's added", () => {
    const edits = diffSequences(words("a b c"), words("a x c"));
    expect(edits.map((edit) => edit.kind)).toEqual([
      "equal",
      "removed",
      "added",
      "equal",
    ]);
  });

  it("handles empty sides and equal sequences", () => {
    expect(diffSequences([], words("a b"))).toEqual([
      { kind: "added", b: 0 },
      { kind: "added", b: 1 },
    ]);
    expect(diffSequences(words("a b"), [])).toHaveLength(2);
    expect(
      diffSequences(words("a b"), words("a b")).every(
        (e) => e.kind === "equal",
      ),
    ).toBe(true);
  });

  it("gives up on huge changes but stays correct", () => {
    const a = Array.from({ length: 300 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 300 }, (_, i) => `b${i}`);
    const edits = diffSequences(a, b, 10);
    expect(apply(a, b, edits)).toEqual(b);
  });

  it("matches a random sample", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) % 5;
    for (let run = 0; run < 50; run += 1) {
      const a = Array.from({ length: 20 }, () => String(random()));
      const b = Array.from({ length: 25 }, () => String(random()));
      expect(apply(a, b, diffSequences(a, b))).toEqual(b);
    }
  });
});
