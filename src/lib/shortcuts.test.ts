// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignKeys,
  bindingsOf,
  findShortcut,
  getShortcut,
  type KeyPress,
  keysOfPress,
  keysProblem,
  matchesKeys,
  resetKeys,
  resetProblem,
  sanitizeOverrides,
  SHORTCUTS,
} from "./shortcuts";

// jsdom's user agent isn't a Mac's, so Ctrl is the modifier.
const press = (keys: Partial<KeyPress>): KeyPress => ({
  key: "",
  code: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...keys,
});

describe("matching keys", () => {
  it("takes letters by the character typed", () => {
    // AZERTY's Z is where QWERTY has W.
    expect(matchesKeys(press({ key: "z", code: "KeyW", ctrlKey: true }), "mod+z")).toBe(true);
    expect(matchesKeys(press({ key: "w", code: "KeyW", ctrlKey: true }), "mod+z")).toBe(false);
  });

  it("takes a letter key by its place when it types no Latin letter", () => {
    // Russian: the key with Latin N types "т".
    expect(matchesKeys(press({ key: "т", code: "KeyN", ctrlKey: true }), "mod+n")).toBe(true);
  });

  it("takes digits and symbols by the key's place", () => {
    // AZERTY's 1 key types "&" without Shift.
    expect(matchesKeys(press({ key: "&", code: "Digit1", ctrlKey: true }), "mod+1")).toBe(true);
    expect(matchesKeys(press({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }), "mod+shift+period")).toBe(true);
    expect(matchesKeys(press({ key: ".", code: "Period", ctrlKey: true }), "mod+shift+period")).toBe(false);
  });

  it("takes the number pad's digits as digits", () => {
    expect(matchesKeys(press({ key: "0", code: "Numpad0", ctrlKey: true }), "mod+0")).toBe(true);
  });

  it("takes zoom's characters with or without Shift", () => {
    expect(matchesKeys(press({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }), "mod+plus")).toBe(true);
    expect(matchesKeys(press({ key: "+", code: "NumpadAdd", ctrlKey: true }), "mod+plus")).toBe(true);
  });

  it("needs exactly the modifiers asked for", () => {
    expect(matchesKeys(press({ key: "b", code: "KeyB", ctrlKey: true, shiftKey: true }), "mod+b")).toBe(false);
    expect(matchesKeys(press({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }), "mod+b")).toBe(false);
    expect(matchesKeys(press({ key: "b", code: "KeyB", metaKey: true }), "mod+b")).toBe(false);
  });

  it("never takes AltGr, which types characters", () => {
    // German AltGr+8 types "[", and reports Ctrl and Alt on Windows.
    const altGr = press({
      key: "[",
      code: "Digit8",
      ctrlKey: true,
      altKey: true,
      getModifierState: (key) => key === "AltGraph",
    });
    expect(matchesKeys(altGr, "mod+alt+8")).toBe(false);
    expect(keysOfPress(altGr)).toBeNull();
  });
});

describe("on a Mac", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function loadOnMac() {
    vi.resetModules();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Mac OS X)" });
    return import("./shortcuts");
  }

  it("takes ⌘ as Mod and leaves Ctrl to text fields", async () => {
    const mac = await loadOnMac();
    expect(mac.matchesKeys(press({ key: "n", code: "KeyN", metaKey: true }), "mod+n")).toBe(true);
    expect(mac.matchesKeys(press({ key: "n", code: "KeyN", ctrlKey: true }), "mod+n")).toBe(false);
    expect(mac.matchesKeys(press({ key: "Tab", code: "Tab", ctrlKey: true }), "ctrl+tab")).toBe(true);
  });

  it("takes letters by place when ⌥ changes the character", async () => {
    const mac = await loadOnMac();
    expect(mac.matchesKeys(press({ key: "ß", code: "KeyS", metaKey: true, altKey: true }), "mod+alt+s")).toBe(true);
  });
});

describe("recording keys", () => {
  it("writes letters by character and the rest by place", () => {
    expect(keysOfPress(press({ key: "B", code: "KeyB", ctrlKey: true, shiftKey: true }))).toBe("mod+shift+b");
    expect(keysOfPress(press({ key: "é", code: "Digit2", ctrlKey: true }))).toBe("mod+2");
    expect(keysOfPress(press({ key: "=", code: "Equal", ctrlKey: true, altKey: true }))).toBe("mod+alt+equal");
  });

  it("waits while only modifiers are down", () => {
    expect(keysOfPress(press({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
  });
});

describe("checking new keys", () => {
  const bold = getShortcut("bold");

  it("needs Mod or Alt, so typing still works", () => {
    expect(keysProblem(bold, "b", {})).toEqual({ kind: "modifier" });
    expect(keysProblem(bold, "shift+b", {})).toEqual({ kind: "modifier" });
    expect(keysProblem(bold, "alt+b", {})).toBeNull();
  });

  it("keeps system keys", () => {
    expect(keysProblem(bold, "mod+c", {})).toEqual({ kind: "reserved", label: "Copy" });
    expect(keysProblem(bold, "mod+w", {})).toEqual({ kind: "reserved", label: "Close window" });
  });

  it("says which shortcut has the keys, in the editor or the whole app", () => {
    expect(keysProblem(bold, "mod+i", {})).toMatchObject({ kind: "taken", by: { id: "italic" } });
    expect(keysProblem(bold, "mod+k", {})).toMatchObject({ kind: "taken", by: { id: "search" } });
  });

  it("lets a drawing key and an app shortcut share keys", () => {
    expect(keysProblem(getShortcut("search"), "mod+quote", {})).toBeNull();
  });

  it("allows pairs that share keys by default", () => {
    expect(keysProblem(getShortcut("toggleSidebar"), "mod+b", {})).toBeNull();
  });
});

describe("changing keys", () => {
  const bold = getShortcut("bold");
  const italic = getShortcut("italic");

  it("saves only what changed", () => {
    const changed = assignKeys({}, bold, "mod+alt+b");
    expect(changed).toEqual({ bold: ["mod+alt+b"] });
    expect(assignKeys(changed, bold, "mod+b")).toEqual({});
  });

  it("takes keys from another shortcut, leaving it without any", () => {
    const next = assignKeys({}, bold, "mod+i");
    expect(next).toEqual({ bold: ["mod+i"], italic: [] });
    expect(findShortcut(press({ key: "i", code: "KeyI", ctrlKey: true }), "editor", next)?.id).toBe("bold");
  });

  it("asks before a reset takes keys back from another shortcut", () => {
    // Mod+B on Italic also takes it from the sidebar, an app shortcut.
    const moved = assignKeys(assignKeys({}, bold, "mod+alt+b"), italic, "mod+b");
    expect(moved).toEqual({ bold: ["mod+alt+b"], italic: ["mod+b"], toggleSidebar: [] });
    expect(resetProblem(bold, moved)).toMatchObject({ by: { id: "italic" } });
    expect(resetKeys(moved, bold)).toEqual({ italic: [], toggleSidebar: [] });
  });

  it("resets on its own when the keys are free", () => {
    expect(resetProblem(bold, { bold: ["mod+alt+b"] })).toBeNull();
    expect(resetKeys({ bold: ["mod+alt+b"] }, bold)).toEqual({});
  });

  it("keeps the default extra keys until the shortcut changes", () => {
    const zoomIn = getShortcut("zoomIn");
    expect(bindingsOf(zoomIn, {})).toEqual(["mod+=", "mod+plus"]);
    expect(bindingsOf(zoomIn, { zoomIn: ["mod+alt+equal"] })).toEqual(["mod+alt+equal"]);
  });
});

describe("saved changes", () => {
  it("drops anything malformed", () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides({ bold: "mod+b", italic: ["mod+i", 3], code: ["MOD+Shift+E"] })).toEqual({
      code: ["mod+shift+e"],
    });
  });
});

describe("the shortcut list", () => {
  it("has one entry per id", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships without clashes, apart from pairs it allows", () => {
    for (const shortcut of SHORTCUTS) {
      if ("fixed" in shortcut) continue;
      for (const keys of shortcut.keys) {
        const problem = keysProblem(shortcut, keys, {});
        expect(problem?.kind === "taken" ? `${shortcut.id} ${keys} ${problem.by.id}` : null).toBeNull();
      }
    }
  });
});
