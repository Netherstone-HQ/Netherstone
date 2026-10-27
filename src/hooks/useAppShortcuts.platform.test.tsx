// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Recent pulls in the vault, which this doesn't need.
vi.mock("@/lib/recent-files", () => ({ stepRecentFile: vi.fn() }));

const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";

// The modifier is picked from the user agent when the app loads, so each
// platform gets a fresh copy of the modules.
async function renderOn(userAgent: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  vi.resetModules();
  const { useAppShortcuts } = await import("./useAppShortcuts");
  const onNewShard = vi.fn();
  renderHook(() => useAppShortcuts({ onNewShard, onSave: () => {} }));
  return onNewShard;
}

describe("New shard shortcut", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is ⌘N on a Mac", async () => {
    const onNewShard = await renderOn(MAC);
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(onNewShard).toHaveBeenCalledOnce();
  });

  it("leaves Ctrl+N to text fields on a Mac", async () => {
    const onNewShard = await renderOn(MAC);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(onNewShard).not.toHaveBeenCalled();
  });

  it("is Ctrl+N on Linux", async () => {
    const onNewShard = await renderOn(LINUX);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(onNewShard).toHaveBeenCalledOnce();
  });
});
