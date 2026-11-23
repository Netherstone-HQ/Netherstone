// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlateEditor } from "platejs";
import {
  ChunkDrawer,
  drawBlocksThrough,
  isPastDrawnLimit,
  MAX_DRAWN_ELEMENTS,
  MAX_FULLY_DRAWN_ELEMENTS,
  registerChunkDrawer,
  type TrackedChunk,
} from "./deferred-chunks";

// The background steps use the timer fallback WebKit webviews get, which
// fake timers can drive.
const { requestIdleCallback, cancelIdleCallback } = window;

beforeEach(() => {
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
});

afterEach(() => {
  window.requestIdleCallback = requestIdleCallback;
  window.cancelIdleCallback = cancelIdleCallback;
  vi.useRealTimers();
});

describe("ChunkDrawer", () => {
  it("draws the first blocks, then more on request, never fewer", () => {
    const drawer = new ChunkDrawer(10);
    const listener = vi.fn();
    drawer.subscribe(listener);

    expect(drawer.isDrawn(9)).toBe(true);
    expect(drawer.isDrawn(10)).toBe(false);

    drawer.drawThrough(24);
    expect(drawer.isDrawn(24)).toBe(true);
    expect(drawer.isDrawn(25)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    drawer.drawThrough(5);
    expect(drawer.isDrawn(24)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    drawer.drawAll();
    expect(drawer.isDrawn(1_000_000)).toBe(true);
  });

  it("draws in steps until every block is drawn, then everything added", () => {
    vi.useFakeTimers();
    const drawer = new ChunkDrawer(10);
    const onComplete = vi.fn();
    const stop = drawer.drawInBackground(() => 35, 10, onComplete);

    const drawn: number[] = [];
    drawer.subscribe(() => {
      drawn.push([...Array(40).keys()].filter((i) => drawer.isDrawn(i)).length);
    });
    vi.advanceTimersByTime(5_000);
    stop();

    // Fast steps draw more blocks each time.
    expect(drawn[0]).toBe(20);
    expect(drawn).toContain(35);
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(drawer.isDrawn(1_000)).toBe(true);
  });

  it("stops drawing when asked", () => {
    vi.useFakeTimers();
    const drawer = new ChunkDrawer(10);
    drawer.drawInBackground(() => 100, 10)();

    vi.advanceTimersByTime(5_000);
    expect(drawer.isDrawn(10)).toBe(false);
  });
});

describe("ChunkDrawer, once its shard is closed", () => {
  it("undraws from the end in steps, then says it's empty", () => {
    vi.useFakeTimers();
    const drawer = new ChunkDrawer(10);
    drawer.drawAll();
    const drawn: number[] = [];
    drawer.subscribe(() => {
      drawn.push([...Array(40).keys()].filter((i) => drawer.isDrawn(i)).length);
    });
    const onEmpty = vi.fn();

    drawer.undrawInBackground(35, 10, onEmpty);
    expect(drawer.isClosed).toBe(true);
    expect(onEmpty).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);

    expect(drawn).toEqual([25, 15, 5, 0]);
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it("draws nothing more, on request or in the background", () => {
    vi.useFakeTimers();
    const drawer = new ChunkDrawer(10);
    drawer.drawInBackground(() => 100, 10);
    drawer.undrawInBackground(100, 10, () => {});

    drawer.drawThrough(50);
    drawer.drawAll();
    vi.advanceTimersByTime(5_000);

    expect(drawer.isDrawn(0)).toBe(false);
  });

  it("stops undrawing when asked", () => {
    vi.useFakeTimers();
    const drawer = new ChunkDrawer(30);
    const onEmpty = vi.fn();
    drawer.undrawInBackground(30, 10, onEmpty)();

    vi.advanceTimersByTime(5_000);
    expect(drawer.isDrawn(29)).toBe(true);
    expect(onEmpty).not.toHaveBeenCalled();
  });
});

describe("drawBlocksThrough", () => {
  it("says whether a block was already drawn, and draws it", () => {
    const editor = { children: [] } as unknown as SlateEditor;
    const drawer = new ChunkDrawer(10);
    registerChunkDrawer(editor, drawer);

    expect(drawBlocksThrough(editor, 3)).toBe(true);
    expect(drawBlocksThrough(editor, 50)).toBe(false);
    expect(drawer.isDrawn(50)).toBe(true);
    expect(drawBlocksThrough(editor, 50)).toBe(true);
  });

  it("treats an editor drawn all at once as drawn", () => {
    expect(drawBlocksThrough({} as SlateEditor, 500)).toBe(true);
  });
});

describe("ChunkDrawer, for a shard past the drawn-element limit", () => {
  const BLOCKS_PER_CHUNK = 10;
  const BLOCK_HEIGHT_PX = 40;

  /** One-element blocks: a paragraph with one text. */
  const blocks = (count: number) =>
    Array.from({ length: count }, () => ({
      type: "p",
      children: [{ text: "" }],
    }));

  /**
   * Tracks the shard's 10-block chunks as the component does, each laid out
   * at its place on a page scrolled to the top.
   */
  function track(
    drawer: ChunkDrawer,
    blockCount: number,
    isUndrawn: (first: number, last: number) => boolean,
  ) {
    const chunks: TrackedChunk[] = [];
    for (let first = 0; first < blockCount; first += BLOCKS_PER_CHUNK) {
      const last = first + BLOCKS_PER_CHUNK - 1;
      const top = first * BLOCK_HEIGHT_PX;
      const element = document.createElement("div");
      element.getBoundingClientRect = () =>
        ({ top, bottom: top + BLOCK_HEIGHT_PX * BLOCKS_PER_CHUNK }) as DOMRect;
      const chunk: TrackedChunk = {
        first,
        last,
        elements: BLOCKS_PER_CHUNK,
        isUndrawn: isUndrawn(first, last),
        element,
        undraw: () => {
          chunk.isUndrawn = true;
        },
        redraw: () => {
          chunk.isUndrawn = false;
        },
      };
      chunks.push(chunk);
      drawer.track(chunk);
    }
    return chunks;
  }

  it("tells a shard past the limit from one under it", () => {
    expect(isPastDrawnLimit(blocks(MAX_FULLY_DRAWN_ELEMENTS))).toBe(false);
    expect(isPastDrawnLimit(blocks(MAX_FULLY_DRAWN_ELEMENTS + 1))).toBe(true);
  });

  it("draws only the first part, and others when asked for", () => {
    const blockCount = MAX_FULLY_DRAWN_ELEMENTS + 500;
    const editor = {
      children: blocks(blockCount),
      selection: null,
    } as unknown as SlateEditor;
    const drawer = new ChunkDrawer(40, 0);
    registerChunkDrawer(editor, drawer);
    const chunks = track(drawer, blockCount, (first, last) =>
      drawer.startsUndrawn(first, last),
    );

    expect(drawer.drawsNearScreenOnly).toBe(true);
    expect(chunks.filter((c) => !c.isUndrawn).map((c) => c.first)).toEqual([
      0, 10, 20, 30,
    ]);

    const lastBlock = blockCount - 1;
    expect(drawBlocksThrough(editor, lastBlock)).toBe(false);
    expect(chunks.at(-1)?.isUndrawn).toBe(false);
    expect(drawBlocksThrough(editor, lastBlock)).toBe(true);
  });

  it("undraws the parts farthest from the screen once past the limit", () => {
    vi.useFakeTimers();
    const blockCount = MAX_FULLY_DRAWN_ELEMENTS + 500;
    const drawer = new ChunkDrawer(blockCount);
    registerChunkDrawer(
      {
        children: blocks(blockCount),
        selection: null,
      } as unknown as SlateEditor,
      drawer,
    );
    const chunks = track(drawer, blockCount, () => false);

    vi.advanceTimersByTime(60_000);

    const drawn = chunks.filter((c) => !c.isUndrawn);
    expect(drawn.length * BLOCKS_PER_CHUNK).toBeLessThanOrEqual(
      MAX_DRAWN_ELEMENTS,
    );
    expect(drawn[0].first).toBe(0);
    expect(chunks.at(-1)?.isUndrawn).toBe(true);
  });

  it("leaves a shard under the limit fully drawn", () => {
    vi.useFakeTimers();
    const blockCount = 2_000;
    const drawer = new ChunkDrawer(blockCount);
    registerChunkDrawer(
      {
        children: blocks(blockCount),
        selection: null,
      } as unknown as SlateEditor,
      drawer,
    );
    const chunks = track(drawer, blockCount, () => false);

    vi.advanceTimersByTime(60_000);

    expect(drawer.drawsNearScreenOnly).toBe(false);
    expect(chunks.every((c) => !c.isUndrawn)).toBe(true);
  });
});
