/** macOS, where ⌘ plays the part Ctrl plays on Windows and Linux. */
export const IS_MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/**
 * Whether a shortcut's modifier is held: ⌘ on a Mac, Ctrl elsewhere. Ctrl on
 * a Mac is left alone, since text fields use it (Ctrl+N moves down a line).
 */
export function hasModKey(e: KeyboardEvent): boolean {
  return IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
