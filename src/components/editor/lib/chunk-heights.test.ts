// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureChunkHeightsInBackground } from "./chunk-heights";

function addChunks(root: HTMLElement, heights: number[]) {
  return heights.map((height) => {
    const chunk = document.createElement("div");
    chunk.setAttribute("data-slate-chunk", "");
    chunk.getBoundingClientRect = vi.fn(() => ({ height }) as DOMRect);
    root.append(chunk);
    return chunk;
  });
}

function renderChunks(heights: number[]) {
  const root = document.createElement("div");
  const chunks = addChunks(root, heights);

  document.body.append(root);
  return { root, chunks };
}

const measureCounts = (chunks: HTMLElement[]) =>
  chunks.map((chunk) => vi.mocked(chunk.getBoundingClientRect).mock.calls.length);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// WebKit webviews (Linux, macOS) have no requestIdleCallback.
describe("without requestIdleCallback", () => {
  const { requestIdleCallback, cancelIdleCallback } = window;

  beforeEach(() => {
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.requestIdleCallback = requestIdleCallback;
    window.cancelIdleCallback = cancelIdleCallback;
  });

  it("still measures every chunk", () => {
    expect("requestIdleCallback" in window).toBe(false);
    expect("cancelIdleCallback" in window).toBe(false);

    const { root, chunks } = renderChunks([120, 48.4]);
    const onComplete = vi.fn();

    const stop = measureChunkHeightsInBackground(root, { onComplete });
    vi.runAllTimers();
    stop();

    expect(chunks.map((chunk) => chunk.style.containIntrinsicSize)).toEqual([
      "auto 120px",
      "auto 48px",
    ]);
    expect(chunks.map((chunk) => chunk.style.contentVisibility)).toEqual([
      "auto",
      "auto",
    ]);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("stops measuring when cancelled", () => {
    const { root, chunks } = renderChunks([120]);
    const onComplete = vi.fn();

    const stop = measureChunkHeightsInBackground(root, { onComplete });
    stop();
    vi.runAllTimers();

    expect(chunks[0].style.containIntrinsicSize).toBe("");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("measures each chunk once across passes", () => {
    const { root, chunks: first } = renderChunks([120, 48]);

    const stopFirst = measureChunkHeightsInBackground(root);
    vi.runAllTimers();
    stopFirst();

    // The rest of the shard is drawn, and measured again.
    const rest = addChunks(root, [60]);
    const stopSecond = measureChunkHeightsInBackground(root);
    vi.runAllTimers();
    stopSecond();

    expect(measureCounts([...first, ...rest])).toEqual([1, 1, 1]);
  });

  it("measures every chunk again when the width changes", () => {
    let onResize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );

    const { root, chunks } = renderChunks([120, 48]);
    let width = 600;
    Object.defineProperty(root, "clientWidth", { get: () => width });

    const stop = measureChunkHeightsInBackground(root);
    vi.runAllTimers();

    onResize();
    vi.runAllTimers();
    expect(measureCounts(chunks)).toEqual([1, 1]);

    width = 400;
    onResize();
    vi.runAllTimers();
    stop();

    expect(measureCounts(chunks)).toEqual([2, 2]);
  });
});
