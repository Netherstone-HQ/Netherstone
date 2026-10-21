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
