/** macOS, where ⌘ plays the part Ctrl plays on Windows and Linux. */
export const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** What the system's file manager is called, for "Show in …" actions. */
export const REVEAL_LABEL = IS_MAC
  ? "Show in Finder"
  : typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
    ? "Show in File Explorer"
    : "Show in file manager";

/**
 * Whether a shortcut's modifier is held: ⌘ on a Mac, Ctrl elsewhere. Ctrl on
 * a Mac is left alone, since text fields use it (Ctrl+N moves down a line).
 */
export function hasModKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

const KEY_NAMES: Record<string, string> = IS_MAC
  ? {
      mod: "⌘",
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      enter: "↩",
      period: ".",
      comma: ",",
      minus: "−",
      tab: "Tab",
    }
  : {
      mod: "Ctrl",
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      enter: "Enter",
      period: ".",
      comma: ",",
      minus: "−",
      tab: "Tab",
    };

/**
 * A shortcut's keys, written as in Plate's config ("mod+shift+x"),
 * named for this system.
 */
export function formatKeys(keys: string): string[] {
  return keys.split("+").map((key) => KEY_NAMES[key] ?? key.toUpperCase());
}

/** A button's tooltip with its shortcut: "Bold (Ctrl+B)", or "Bold (⌘+B)". */
export function withShortcut(label: string, keys: string): string {
  return `${label} (${formatKeys(keys).join("+")})`;
}
