// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useAppShortcuts } from "./useAppShortcuts";

// jsdom's user agent isn't a Mac's, so Ctrl is the modifier.
const press = (key: string, shiftKey = false) =>
  fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey });

const zoom = () => useSettingsStore.getState().zoom;

describe("useAppShortcuts zoom", () => {
  beforeEach(() => {
    useSettingsStore.setState({ zoom: 100 });
    useUIStore.setState({ appMode: "notes" });
    renderHook(() => useAppShortcuts({ onNewShard: () => {} }));
  });
  afterEach(cleanup);

  it("zooms in, out and back to 100%", () => {
    press("=");
    expect(zoom()).toBe(110);
    press("+", true);
    expect(zoom()).toBe(125);
    press("-");
    expect(zoom()).toBe(110);
    press("0");
    expect(zoom()).toBe(100);
  });

  it("leaves the keys to the drawing in Canvas", () => {
    useUIStore.setState({ appMode: "canvas" });
    press("=");
    expect(zoom()).toBe(100);
  });
});
