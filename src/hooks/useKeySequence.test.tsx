// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeySequence } from "./useKeySequence";

const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "b", "a"] as const;

const press = (...keys: string[]) => {
  for (const key of keys) fireEvent.keyDown(window, { key });
};

describe("useKeySequence", () => {
  afterEach(cleanup);

  it("fires once the whole sequence is pressed", () => {
    const onMatch = vi.fn();
    renderHook(() => useKeySequence(SEQUENCE, onMatch));
    press("ArrowUp", "ArrowUp", "ArrowDown", "b");
    expect(onMatch).not.toHaveBeenCalled();
    press("a");
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("matches letters in either case", () => {
    const onMatch = vi.fn();
    renderHook(() => useKeySequence(SEQUENCE, onMatch));
    press("ArrowUp", "ArrowUp", "ArrowDown", "B", "A");
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("recovers after extra presses at the start", () => {
    const onMatch = vi.fn();
    renderHook(() => useKeySequence(SEQUENCE, onMatch));
    press("ArrowUp", "ArrowUp", "ArrowUp", "ArrowDown", "b", "a");
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("ignores a wrong key in the middle", () => {
    const onMatch = vi.fn();
    renderHook(() => useKeySequence(SEQUENCE, onMatch));
    press("ArrowUp", "ArrowUp", "x", "ArrowDown", "b", "a");
    expect(onMatch).not.toHaveBeenCalled();
  });

  it("ignores presses inside text fields", () => {
    const onMatch = vi.fn();
    renderHook(() => useKeySequence(SEQUENCE, onMatch));
    const input = document.createElement("input");
    document.body.append(input);
    for (const key of SEQUENCE) fireEvent.keyDown(input, { key });
    input.remove();
    expect(onMatch).not.toHaveBeenCalled();
  });
});
