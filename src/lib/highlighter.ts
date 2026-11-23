import type { createLowlight } from "lowlight";

type Highlighter = ReturnType<typeof createLowlight>;

let highlighter: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

/** The code highlighter, once `loadHighlighter` has run. */
export function getHighlighter() {
  return highlighter;
}

/**
 * Loads the highlighter with every language the editor knows. It's large,
 * so it loads only once a shard or an export has code.
 */
export function loadHighlighter() {
  loading ??= import("lowlight").then(
    ({ all, createLowlight }) => (highlighter = createLowlight(all)),
  );
  return loading;
}
