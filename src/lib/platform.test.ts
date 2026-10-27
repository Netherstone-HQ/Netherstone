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

describe("keysText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins keys with + on Windows and Linux", async () => {
    const { keysText } = await loadOn("Mozilla/5.0 (Windows NT 10.0)");
    expect(keysText("mod+shift+x")).toBe("Ctrl+Shift+X");
  });

  it("writes keys as a Mac does, modifiers in Apple's order", async () => {
    const { keysText, formatKeys } = await loadOn("Mozilla/5.0 (Macintosh; Mac OS X)");
    expect(keysText("mod+shift+x")).toBe("⇧⌘X");
    expect(keysText("mod+alt+1")).toBe("⌥⌘1");
    expect(formatKeys("ctrl+shift+tab")).toEqual(["⌃", "⇧", "Tab"]);
  });
});
