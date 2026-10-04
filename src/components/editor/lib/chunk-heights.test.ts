// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureChunkHeightsInBackground } from "./chunk-heights";

function renderChunks(heights: number[]) {
  const root = document.createElement("div");

  const chunks = heights.map((height) => {
    const chunk = document.createElement("div");
    chunk.setAttribute("data-slate-chunk", "");
    chunk.getBoundingClientRect = () => ({ height }) as DOMRect;
    root.append(chunk);
    return chunk;
  });

  document.body.append(root);
  return { root, chunks };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
});

it("uses requestIdleCallback where the browser has it", () => {
  const requestIdleCallback = vi.spyOn(window, "requestIdleCallback");
  const cancelIdleCallback = vi.spyOn(window, "cancelIdleCallback");
  const { root } = renderChunks([120]);

  const stop = measureChunkHeightsInBackground(root);
  stop();

  expect(requestIdleCallback).toHaveBeenCalledOnce();
  expect(cancelIdleCallback).toHaveBeenCalledWith(
    requestIdleCallback.mock.results[0].value,
  );
});
