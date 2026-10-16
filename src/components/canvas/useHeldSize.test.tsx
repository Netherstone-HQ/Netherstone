// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHeldSize } from "./useHeldSize";

let resize: (width: number, height: number) => void = () => {};

class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resize = (width, height) =>
      callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
  }
  observe() {}
  disconnect() {}
}

describe("useHeldSize", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("holds the last size while the space collapses, as when minimized", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const frame = document.createElement("div");
    const { result } = renderHook(() => useHeldSize(frame));

    act(() => resize(1392, 816));
    expect(result.current).toBeNull();

    act(() => resize(0, 0));
    expect(result.current).toEqual({ width: 1392, height: 816 });

    act(() => resize(1392, 816));
    expect(result.current).toBeNull();
  });

  it("follows real resizes", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const frame = document.createElement("div");
    const { result } = renderHook(() => useHeldSize(frame));

    act(() => resize(1392, 816));
    act(() => resize(900, 700));
    act(() => resize(1392, 0));
    expect(result.current).toEqual({ width: 900, height: 700 });
  });
});
