// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadOn(userAgent: string) {
  vi.resetModules();
  vi.stubGlobal("navigator", { userAgent });
  return import("./platform");
}

const press = (keys: Partial<KeyboardEvent>) =>
  new KeyboardEvent("keydown", { key: "n", ...keys });

describe("hasModKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("takes Ctrl, not ⌘, on Windows and Linux", async () => {
    const { hasModKey } = await loadOn("Mozilla/5.0 (Windows NT 10.0)");
    expect(hasModKey(press({ ctrlKey: true }))).toBe(true);
    expect(hasModKey(press({ metaKey: true }))).toBe(false);
  });

  it("takes ⌘, not Ctrl, on a Mac", async () => {
    const { hasModKey } = await loadOn("Mozilla/5.0 (Macintosh; Mac OS X)");
    expect(hasModKey(press({ metaKey: true }))).toBe(true);
    expect(hasModKey(press({ ctrlKey: true }))).toBe(false);
  });
});
