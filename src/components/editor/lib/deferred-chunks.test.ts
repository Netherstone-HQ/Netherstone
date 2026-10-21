// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlateEditor } from "platejs";
import {
  ChunkDrawer,
  drawBlocksThrough,
  registerChunkDrawer,
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

describe("drawBlocksThrough", () => {
  it("says whether a block was already drawn, and draws it", () => {
    const editor = {} as SlateEditor;
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
