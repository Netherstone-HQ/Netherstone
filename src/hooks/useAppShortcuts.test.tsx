// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stepRecentFile } from "@/lib/recent-files";
import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useAppShortcuts } from "./useAppShortcuts";

vi.mock("@/lib/recent-files", () => ({ stepRecentFile: vi.fn() }));

// jsdom's user agent isn't a Mac's, so Ctrl is the modifier.
const press = (key: string, code: string, shiftKey = false) =>
  fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey });

const render = (handlers: Partial<Parameters<typeof useAppShortcuts>[0]> = {}) =>
  renderHook(() =>
    useAppShortcuts({ onNewShard: () => {}, onSave: () => {}, ...handlers }),
  );

const zoom = () => useSettingsStore.getState().zoom;

describe("useAppShortcuts zoom", () => {
  beforeEach(() => {
    useSettingsStore.setState({ zoom: 100, shortcuts: {} });
    useUIStore.setState({ appMode: "notes" });
    render();
  });
  afterEach(cleanup);

  it("zooms in, out and back to 100%", () => {
    press("=", "Equal");
    expect(zoom()).toBe(110);
    press("+", "Equal", true);
    expect(zoom()).toBe(125);
    press("-", "Minus");
    expect(zoom()).toBe(110);
    press("0", "Digit0");
    expect(zoom()).toBe(100);
  });

  it("zooms by the character on layouts where + and − sit elsewhere", () => {
    // German: + has its own key, − is where / is in English.
    press("+", "BracketRight");
    expect(zoom()).toBe(110);
    press("-", "Slash");
    expect(zoom()).toBe(100);
  });

  it("leaves the keys to the drawing in Canvas", () => {
    useUIStore.setState({ appMode: "canvas" });
    press("=", "Equal");
    expect(zoom()).toBe(100);
  });
});

describe("useAppShortcuts modes", () => {
  beforeEach(() => {
    useUIStore.setState({ appMode: "notes", activeNavItem: null });
    useSettingsStore.setState({ shortcuts: {} });
    render();
  });
  afterEach(cleanup);

  it("opens the rail's modes in order by physical key", () => {
    const pressDigit = (digit: number) =>
      fireEvent.keyDown(window, {
        key: "&",
        code: `Digit${digit}`,
        ctrlKey: true,
      });

    pressDigit(2);
    expect(useUIStore.getState().appMode).toBe("canvas");
    pressDigit(3);
    expect(useUIStore.getState().appMode).toBe("tags");
    pressDigit(4);
    expect(useUIStore.getState().appMode).toBe("gallery");
    pressDigit(5);
    expect(useUIStore.getState().appMode).toBe("data");
    pressDigit(1);
    expect(useUIStore.getState().appMode).toBe("notes");
  });
});

describe("useAppShortcuts save", () => {
  const onSave = vi.fn();

  beforeEach(() => {
    onSave.mockClear();
    useUIStore.setState({ appMode: "notes" });
    useSettingsStore.setState({ shortcuts: {} });
    render({ onSave });
  });
  afterEach(cleanup);

  it("saves the open shard", () => {
    press("s", "KeyS");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("leaves the key to the drawing in Canvas", () => {
    useUIStore.setState({ appMode: "canvas" });
    press("s", "KeyS");
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("useAppShortcuts Recent", () => {
  beforeEach(() => {
    vi.mocked(stepRecentFile).mockClear();
    useSettingsStore.setState({ shortcuts: {} });
    render();
  });
  afterEach(cleanup);

  it("steps down Recent on Ctrl+Tab and up with Shift", () => {
    press("Tab", "Tab");
    press("Tab", "Tab", true);
    expect(vi.mocked(stepRecentFile).mock.calls).toEqual([[1], [-1]]);
  });

  it("keeps Tab from reaching the editor", () => {
    const editor = document.createElement("div");
    document.body.append(editor);
    const onKeyDown = vi.fn();
    editor.addEventListener("keydown", onKeyDown);
    fireEvent.keyDown(editor, { key: "Tab", code: "Tab", ctrlKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
    editor.remove();
  });

  it("leaves Tab alone without Ctrl", () => {
    fireEvent.keyDown(window, { key: "Tab", code: "Tab" });
    fireEvent.keyDown(window, { key: "Tab", code: "Tab", metaKey: true });
    expect(stepRecentFile).not.toHaveBeenCalled();
  });
});

describe("useAppShortcuts changed keys", () => {
  const onNewShard = vi.fn();

  beforeEach(() => {
    onNewShard.mockClear();
    useUIStore.setState({ isSidebarOpen: true });
    render({ onNewShard });
  });
  afterEach(cleanup);

  it("runs on the keys set in Settings, not the defaults", () => {
    useSettingsStore.setState({ shortcuts: { newShard: ["mod+alt+n"] } });
    press("n", "KeyN");
    expect(onNewShard).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "n", code: "KeyN", ctrlKey: true, altKey: true });
    expect(onNewShard).toHaveBeenCalledOnce();
  });

  it("does nothing for a shortcut left without keys", () => {
    useSettingsStore.setState({ shortcuts: { newShard: [] } });
    press("n", "KeyN");
    expect(onNewShard).not.toHaveBeenCalled();
  });

  it("leaves the editor's own shortcut on the same keys to the editor", () => {
    useSettingsStore.setState({ shortcuts: {} });
    const editor = document.createElement("div");
    editor.setAttribute("data-slate-editor", "true");
    document.body.append(editor);
    fireEvent.keyDown(editor, { key: "b", code: "KeyB", ctrlKey: true });
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
    press("b", "KeyB");
    expect(useUIStore.getState().isSidebarOpen).toBe(false);
    editor.remove();
  });

  it("stays out of the way while Settings records keys", () => {
    useSettingsStore.setState({ shortcuts: {} });
    const recorder = document.createElement("button");
    recorder.setAttribute("data-shortcut-recorder", "");
    document.body.append(recorder);
    fireEvent.keyDown(recorder, { key: "n", code: "KeyN", ctrlKey: true });
    expect(onNewShard).not.toHaveBeenCalled();
    recorder.remove();
  });
});
