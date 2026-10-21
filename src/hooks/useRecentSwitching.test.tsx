// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endRecentCycle, stepRecentFile } from "@/lib/recent-files";
import { useRecentSwitching } from "./useRecentSwitching";

vi.mock("@/lib/recent-files", () => ({
  endRecentCycle: vi.fn(),
  stepRecentFile: vi.fn(),
}));

describe("useRecentSwitching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderHook(() => useRecentSwitching());
  });
  afterEach(cleanup);

  it("steps down Recent on Ctrl+Tab and up with Shift", () => {
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
    expect(vi.mocked(stepRecentFile).mock.calls).toEqual([[1], [-1]]);
  });

  it("keeps Tab from reaching the editor", () => {
    const editor = document.createElement("div");
    document.body.append(editor);
    const onKeyDown = vi.fn();
    editor.addEventListener("keydown", onKeyDown);
    fireEvent.keyDown(editor, { key: "Tab", ctrlKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
    editor.remove();
  });

  it("leaves Tab alone without Ctrl", () => {
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "Tab", metaKey: true });
    expect(stepRecentFile).not.toHaveBeenCalled();
  });

  it("ends the cycle when Ctrl is let go", () => {
    fireEvent.keyUp(window, { key: "Control" });
    expect(endRecentCycle).toHaveBeenCalled();
  });
});
