import type katex from "katex";

let engine: typeof katex | null = null;

/**
 * Loads KaTeX, which turns math into HTML and Word math. It's large, so it
 * loads only for documents with math; until then math shows as its source.
 */
export async function loadMath() {
  engine ??= (await import("katex")).default;
}

/** KaTeX once `loadMath` has run, else null. */
export function mathEngine() {
  return engine;
}
