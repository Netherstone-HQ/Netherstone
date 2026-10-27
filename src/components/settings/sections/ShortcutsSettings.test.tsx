// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/store/settings";
import { ShortcutsSettings } from "./ShortcutsSettings";

// jsdom's user agent isn't a Mac's, so Ctrl is the modifier.
const record = (label: string, keys: Partial<KeyboardEvent>) => {
  const button = screen.getByRole("button", { name: `Change keys for ${label}` });
  fireEvent.click(button);
  return fireEvent.keyDown(button, keys);
};

const row = (label: string) =>
  screen.getByRole("button", { name: `Change keys for ${label}` }).parentElement!.parentElement!;

describe("ShortcutsSettings", () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcuts: {} });
    render(<ShortcutsSettings />);
  });
  afterEach(cleanup);

  it("saves new keys and offers to restore the default", () => {
    record("Bold", { key: "b", code: "KeyB", ctrlKey: true, altKey: true });
    expect(useSettingsStore.getState().shortcuts).toEqual({ bold: ["mod+alt+b"] });
    expect(within(row("Bold")).getByText("Alt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore default keys for Bold" }));
    expect(useSettingsStore.getState().shortcuts).toEqual({});
  });

  it("says who has the keys and replaces only when asked", () => {
    record("Bold", { key: "i", code: "KeyI", ctrlKey: true });
    expect(within(row("Bold")).getByText("Used by Italic")).toBeTruthy();
    expect(useSettingsStore.getState().shortcuts).toEqual({});

    fireEvent.click(within(row("Bold")).getByRole("button", { name: "Replace" }));
    expect(useSettingsStore.getState().shortcuts).toEqual({ bold: ["mod+i"], italic: [] });
    expect(within(row("Italic")).getByText("Not set")).toBeTruthy();
  });

  it("refuses system keys and keys without a modifier", () => {
    record("Bold", { key: "c", code: "KeyC", ctrlKey: true });
    expect(within(row("Bold")).getByText("Reserved for Copy")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Change keys for Bold" }), {
      key: "b",
      code: "KeyB",
    });
    expect(within(row("Bold")).getByText("Add Ctrl or Alt")).toBeTruthy();
    expect(useSettingsStore.getState().shortcuts).toEqual({});
  });

  it("stops recording on Escape without closing Settings", () => {
    const pressed = record("Bold", { key: "Escape", code: "Escape" });
    expect(pressed).toBe(false); // handled, so Settings stays open
    expect(screen.queryByText("Press keys")).toBeNull();
  });

  it("lists drawing keys without letting them change", () => {
    expect(screen.getByText("Rectangle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change keys for Rectangle" })).toBeNull();
  });
});
