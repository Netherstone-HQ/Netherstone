import { describe, expect, it } from "vitest";
import { diffBlocks, mergeHunks, type BlockHunk } from "@/lib/block-merge";
import { random } from "@/test/random";

/** Applies `hunks` from `diffBlocks(current, next)` to `current`. */
function patch<T>(current: T[], next: T[], hunks: BlockHunk[]) {
  const result = [...current];
  for (const hunk of [...hunks].reverse()) {
    result.splice(hunk.start, hunk.end - hunk.start, ...next.slice(hunk.nextStart, hunk.nextEnd));
  }
  return result;
}

describe("diffBlocks", () => {
  it("finds each run that differs", () => {
    expect(diffBlocks([1, 2, 3, 4, 5, 6], [1, 9, 3, 4, 5, 8])).toEqual([
      { start: 1, end: 2, nextStart: 1, nextEnd: 2 },
      { start: 5, end: 6, nextStart: 5, nextEnd: 6 },
    ]);
    expect(diffBlocks([1, 4], [1, 2, 3, 4])).toEqual([
      { start: 1, end: 1, nextStart: 1, nextEnd: 3 },
    ]);
    expect(diffBlocks([1, 2, 3, 4], [2, 4])).toEqual([
      { start: 0, end: 1, nextStart: 0, nextEnd: 0 },
      { start: 2, end: 3, nextStart: 1, nextEnd: 1 },
    ]);
    expect(diffBlocks([1, 2], [1, 2])).toEqual([]);
    expect(diffBlocks([], [1])).toEqual([{ start: 0, end: 0, nextStart: 0, nextEnd: 1 }]);
  });

  it("compares blocks by content, ignoring ids and key order", () => {
    expect(
      diffBlocks(
        [{ type: "p", id: "a", children: [{ text: "x", bold: true }] }],
        [{ children: [{ bold: true, text: "x" }], id: "b", type: "p" }],
      ),
    ).toEqual([]);
  });

  it("compares blocks as objects when asked", () => {
    const one = { text: "x" };
    expect(diffBlocks([one], [one], { byIdentity: true })).toEqual([]);
    expect(diffBlocks([one], [{ text: "x" }], { byIdentity: true })).toHaveLength(1);
  });

  it("always describes the second value", () => {
    const next = random(7);
    for (let round = 0; round < 300; round += 1) {
      const a = Array.from({ length: next(30) }, () => next(6));
      const b = Array.from({ length: next(30) }, () => next(6));
      const hunks = diffBlocks(a, b);
      expect(patch(a, b, hunks)).toEqual(b);
      // Runs are in order and never touch.
      hunks.slice(1).forEach((hunk, index) => {
        expect(hunk.start).toBeGreaterThan(hunks[index].end);
      });
    }
  });

  it("keeps far-apart changes apart in long values", () => {
    const a = Array.from({ length: 5000 }, (_, index) => index);
    const b = [...a];
    b[10] = -1;
    b[4990] = -2;
    expect(diffBlocks(a, b)).toHaveLength(2);
  });

  it("falls back to one run when the values share little", () => {
    const a = Array.from({ length: 3000 }, (_, index) => index);
    const b = a.map((value) => (value % 2 ? -value : value));
    const hunks = diffBlocks(a, b);
    expect(patch(a, b, hunks)).toEqual(b);
  });
});

describe("mergeHunks", () => {
  const hunk = (start: number, end: number, count = end - start): BlockHunk => ({
    start,
    end,
    nextStart: start,
    nextEnd: start + count,
  });
  const never = () => false;

  it("places their changes around ours", () => {
    // Ours adds a block at 2; theirs changes 0 and 5.
    expect(mergeHunks([hunk(2, 2, 1)], [hunk(0, 1), hunk(5, 6)], never)).toEqual([
      { hunk: hunk(0, 1), start: 0 },
      { hunk: hunk(5, 6), start: 6 },
    ]);
  });

  it("merges changes to blocks next to each other", () => {
    expect(mergeHunks([hunk(2, 3)], [hunk(3, 4)], never)).not.toBeNull();
    expect(mergeHunks([hunk(3, 4)], [hunk(2, 3)], never)).not.toBeNull();
    // An insert right before or after a changed block.
    expect(mergeHunks([hunk(3, 3, 1)], [hunk(3, 4)], never)).toEqual([
      { hunk: hunk(3, 4), start: 4 },
    ]);
    expect(mergeHunks([hunk(3, 4)], [hunk(4, 4, 2)], never)).toEqual([
      { hunk: hunk(4, 4, 2), start: 4 },
    ]);
  });

  it("refuses changes to the same blocks", () => {
    expect(mergeHunks([hunk(2, 4)], [hunk(3, 5)], never)).toBeNull();
    expect(mergeHunks([hunk(2, 5)], [hunk(3, 3, 1)], never)).toBeNull();
  });

  it("merges a removed block next to an edit, and refuses one inside it", () => {
    // Theirs removes block 3; ours changes block 2.
    expect(mergeHunks([hunk(2, 3)], [hunk(3, 4, 0)], never)).toEqual([
      { hunk: hunk(3, 4, 0), start: 3 },
    ]);
    // Ours removed blocks 2 to 4; theirs changes block 3.
    expect(mergeHunks([hunk(2, 5, 0)], [hunk(3, 4)], never)).toBeNull();
  });

  it("refuses blocks added at the same place", () => {
    expect(mergeHunks([hunk(2, 2, 1)], [hunk(2, 2, 1)], never)).toBeNull();
  });

  it("leaves out a change both made alike", () => {
    expect(mergeHunks([hunk(2, 3)], [hunk(2, 3), hunk(6, 7)], () => true)).toEqual([
      { hunk: hunk(6, 7), start: 6 },
    ]);
  });
});
