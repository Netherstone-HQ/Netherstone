// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endRecentCycle } from "@/lib/recent-files";
import { useSettingsStore } from "@/store/settings";
import { useRecentSwitching } from "./useRecentSwitching";

vi.mock("@/lib/recent-files", () => ({ endRecentCycle: vi.fn() }));

describe("useRecentSwitching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ shortcuts: {} });
    renderHook(() => useRecentSwitching());
  });
  afterEach(cleanup);

  it("ends the cycle when Ctrl is let go", () => {
    fireEvent.keyUp(window, { key: "Control" });
    expect(endRecentCycle).toHaveBeenCalled();
  });

  it("keeps it going while Ctrl is still held", () => {
    fireEvent.keyUp(window, { key: "Shift", ctrlKey: true });
    fireEvent.keyUp(window, { key: "Tab", ctrlKey: true });
    expect(endRecentCycle).not.toHaveBeenCalled();
  });

  it("ends it on the modifier of changed keys", () => {
    useSettingsStore.setState({
      shortcuts: { nextRecent: ["alt+j"], previousRecent: ["alt+k"] },
    });
    fireEvent.keyUp(window, { key: "Control", altKey: true });
    expect(endRecentCycle).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { key: "Alt" });
    expect(endRecentCycle).toHaveBeenCalled();
  });
});
