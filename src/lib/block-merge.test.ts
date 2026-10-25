// @vitest-environment jsdom
import { createSlateEditor, NodeApi, type Descendant } from "platejs";
import { describe, expect, it } from "vitest";
import { SerializationKit } from "@/components/editor/serialization-kit";
import {
  diffBlocks,
  mergeHunks,
  rebaseHistory,
  type BlockHunk,
} from "@/lib/block-merge";
import { loadMarkdown } from "@/test/markdown";

/** Applies `hunks` from `diffBlocks(current, next)` to `current`. */
function patch<T>(current: T[], next: T[], hunks: BlockHunk[]) {
  const result = [...current];
  for (const hunk of [...hunks].reverse()) {
    result.splice(hunk.start, hunk.end - hunk.start, ...next.slice(hunk.nextStart, hunk.nextEnd));
  }
  return result;
}

function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % below;
  };
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

  it("refuses blocks added at the same place", () => {
    expect(mergeHunks([hunk(2, 2, 1)], [hunk(2, 2, 1)], never)).toBeNull();
  });

  it("leaves out a change both made alike", () => {
    expect(mergeHunks([hunk(2, 3)], [hunk(2, 3), hunk(6, 7)], () => true)).toEqual([
      { hunk: hunk(6, 7), start: 6 },
    ]);
  });
});

describe("rebaseHistory", () => {
  function createEditor(markdown: string) {
    return createSlateEditor({ plugins: SerializationKit, value: loadMarkdown(markdown) });
  }
  type Editor = ReturnType<typeof createEditor>;

  const texts = (editor: Editor) => editor.children.map((node) => NodeApi.string(node));

  /** Each typed word is its own undo step. */
  function type(editor: Editor, index: number, text: string) {
    editor.tf.withNewBatch(() => {
      editor.tf.insertText(text, { at: editor.api.end([index])! });
    });
  }

  /** Replaces blocks the way an outside change does, keeping history. */
  function replace(editor: Editor, start: number, end: number, markdown: string) {
    const blocks = markdown ? (loadMarkdown(markdown) as Descendant[]) : [];
    editor.tf.withoutSaving(() => {
      for (let index = end - 1; index >= start; index -= 1) {
        editor.tf.apply({ type: "remove_node", path: [index], node: editor.children[index] });
      }
      blocks.forEach((node, offset) => {
        editor.tf.apply({ type: "insert_node", path: [start + offset], node });
      });
    });
    rebaseHistory(editor, [{ start, end, count: blocks.length }]);
  }

  it("keeps undo working around blocks changed outside", () => {
    const editor = createEditor("One\n\nTwo\n\nThree\n\nFour\n");
    type(editor, 0, "!");
    type(editor, 3, "?");
    replace(editor, 1, 3, "Outside A\n\nOutside B\n\nOutside C\n");
    expect(texts(editor)).toEqual(["One!", "Outside A", "Outside B", "Outside C", "Four?"]);

    editor.undo();
    expect(texts(editor)).toEqual(["One!", "Outside A", "Outside B", "Outside C", "Four"]);
    editor.undo();
    expect(texts(editor)).toEqual(["One", "Outside A", "Outside B", "Outside C", "Four"]);

    editor.redo();
    editor.redo();
    expect(texts(editor)).toEqual(["One!", "Outside A", "Outside B", "Outside C", "Four?"]);
  });

  it("drops steps in blocks changed outside, and those before them", () => {
    const editor = createEditor("One\n\nTwo\n\nThree\n");
    type(editor, 0, "1");
    type(editor, 1, "2");
    type(editor, 2, "3");
    replace(editor, 1, 2, "Outside\n");

    expect(editor.history.undos).toHaveLength(1);
    editor.undo();
    expect(texts(editor)).toEqual(["One1", "Outside", "Three"]);
    editor.undo();
    expect(texts(editor)).toEqual(["One1", "Outside", "Three"]);
  });

  it("moves split and joined blocks", () => {
    const editor = createEditor("One\n\nTwo\n\nThree\n");
    // Enter in the middle of "Three", then Backspace at the start of "Two".
    editor.tf.withNewBatch(() => {
      editor.tf.select({ path: [2, 0], offset: 2 });
      editor.tf.insertBreak();
    });
    editor.tf.withNewBatch(() => {
      editor.tf.select({ path: [1, 0], offset: 0 });
      editor.tf.deleteBackward();
    });
    expect(texts(editor)).toEqual(["OneTwo", "Th", "ree"]);

    replace(editor, 0, 0, "Zero\n\nZero again\n");
    editor.undo();
    expect(texts(editor)).toEqual(["Zero", "Zero again", "One", "Two", "Th", "ree"]);
    editor.undo();
    expect(texts(editor)).toEqual(["Zero", "Zero again", "One", "Two", "Three"]);
  });

  it("moves where undo puts the cursor", () => {
    const editor = createEditor("One\n\nTwo\n");
    editor.tf.select(editor.api.end([1])!);
    editor.tf.insertText("!");
    replace(editor, 0, 0, "Zero\n");
    editor.tf.deselect();

    editor.undo();
    expect(editor.selection?.anchor.path[0]).toBe(2);
  });

  it("lets undo get back to the first text with only the outside change in", () => {
    const next = random(11);
    for (let round = 0; round < 60; round += 1) {
      const length = 4 + next(6);
      const lines = Array.from({ length }, (_, index) => `Line ${index}`);
      const editor = createEditor(lines.join("\n\n") + "\n");
      const original = texts(editor);

      // Edits to the first blocks; the outside change is in the rest.
      const tail = length - Math.floor(length / 2);
      for (let step = 0; step < 10; step += 1) {
        const index = next(editor.children.length - tail);
        const offset = next(NodeApi.string(editor.children[index]).length + 1);
        editor.tf.withNewBatch(() => {
          switch (next(4)) {
            case 0:
              editor.tf.insertText(`+${step}`, { at: editor.api.end([index])! });
              break;
            case 1:
              editor.tf.select({ path: [index, 0], offset });
              editor.tf.insertBreak();
              break;
            case 2:
              editor.tf.insertNodes(
                { type: "p", children: [{ text: `new ${step}` }] },
                { at: [index] },
              );
              break;
            default:
              if (index > 0) {
                editor.tf.select({ path: [index, 0], offset: 0 });
                editor.tf.deleteBackward();
              }
          }
        });
      }

      const edited = texts(editor);
      const steps = editor.history.undos.length;
      const added = editor.children.length - length;
      const start = editor.children.length - tail + next(tail + 1);
      const end = start + next(editor.children.length - start + 1);
      replace(editor, start, end, `Outside ${round}\n`);
      expect(editor.history.undos).toHaveLength(steps);

      for (let step = 0; step < steps; step += 1) editor.undo();
      const expected = [...original];
      expected.splice(start - added, end - start, `Outside ${round}`);
      expect(texts(editor)).toEqual(expected);

      for (let step = 0; step < steps; step += 1) editor.redo();
      const redone = [...edited];
      redone.splice(start, end - start, `Outside ${round}`);
      expect(texts(editor)).toEqual(redone);
    }
  });
});
