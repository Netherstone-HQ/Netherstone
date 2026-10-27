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

/** Names for keys whose name isn't the key itself, the same on every system. */
const SHARED_KEY_NAMES: Record<string, string> = {
  period: ".",
  comma: ",",
  minus: "−",
  "-": "−",
  equal: "=",
  plus: "+",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  backquote: "`",
  bracketleft: "[",
  bracketright: "]",
  intlbackslash: "<",
  tab: "Tab",
  space: "Space",
  escape: "Esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "Page Up",
  pagedown: "Page Down",
  numpadadd: "Num +",
  numpadsubtract: "Num −",
  numpadmultiply: "Num *",
  numpaddivide: "Num /",
  numpaddecimal: "Num .",
  click: "Click",
};

const KEY_NAMES: Record<string, string> = IS_MAC
  ? {
      ...SHARED_KEY_NAMES,
      mod: "⌘",
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      enter: "↩",
      backspace: "⌫",
      delete: "⌦",
    }
  : {
      ...SHARED_KEY_NAMES,
      mod: "Ctrl",
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      enter: "Enter",
    };

function keyName(key: string): string {
  const name = KEY_NAMES[key];
  if (name) return name;
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}

/** Apple's order for modifiers: ⌃⌥⇧⌘. */
const MAC_MODIFIER_ORDER = ["ctrl", "alt", "shift", "mod"];

/**
 * A shortcut's keys, written as in the shortcut list ("mod+shift+x"),
 * named for this system. On a Mac the modifiers come in Apple's order.
 */
export function formatKeys(keys: string): string[] {
  const parts = keys.split("+");
  if (IS_MAC) {
    const key = parts.pop()!;
    parts.sort(
      (a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b),
    );
    parts.push(key);
  }
  return parts.map(keyName);
}

/**
 * A shortcut's keys as one line, as the system writes them: "Ctrl+Shift+X",
 * or "⇧⌘X" on a Mac.
 */
export function keysText(keys: string): string {
  return formatKeys(keys).join(IS_MAC ? "" : "+");
}

/**
 * A button's tooltip with its shortcut: "Bold (Ctrl+B)", or "Bold (⌘B)".
 * Just the label when the shortcut has no keys.
 */
export function withShortcut(label: string, keys: string | null): string {
  return keys ? `${label} (${keysText(keys)})` : label;
}
