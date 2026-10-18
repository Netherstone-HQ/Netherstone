import { createSlatePlugin, type TElement } from "platejs";

/**
 * YAML front matter: a `---` block at the very start of a shard, as Obsidian
 * and static site generators write it. The editor has no UI for it yet, so
 * it is carried through unchanged: split off before Markdown parsing, held
 * in a read-only block at the top of the document, and written back first.
 */

export const FRONT_MATTER_KEY = "front_matter";

export type TFrontMatterElement = TElement & {
  type: typeof FRONT_MATTER_KEY;
  /** The block exactly as it was in the file, fences included, no final newline. */
  value: string;
};

// `---`, any lines, then `---` (or `...`) on its own line, or at the end of
// the file. CRLF files keep their line endings in `value`.
const FRONT_MATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export type SplitFrontMatter = {
  frontMatter: string | null;
  body: string;
};

/** Splits a leading front matter block from the Markdown that follows it. */
export function splitFrontMatter(markdown: string): SplitFrontMatter {
  const match = FRONT_MATTER.exec(markdown);
  if (!match) return { frontMatter: null, body: markdown };

  const frontMatter = match[0].replace(/\r?\n$/, "");
  // A blank line after the block is the usual style and is put back on save.
  const body = markdown.slice(match[0].length).replace(/^(\r?\n)+/, "");

  return { frontMatter, body };
}

export function createFrontMatterNode(value: string): TFrontMatterElement {
  return { type: FRONT_MATTER_KEY, value, children: [{ text: "" }] };
}

export function isFrontMatterNode(node: unknown): node is TFrontMatterElement {
  return (
    !!node &&
    typeof node === "object" &&
    (node as TElement).type === FRONT_MATTER_KEY &&
    typeof (node as TFrontMatterElement).value === "string"
  );
}

/** Joins front matter and body back into one file. */
export function joinFrontMatter(frontMatter: string | null, body: string): string {
  if (frontMatter === null) return body;
  if (body === "") return `${frontMatter}\n`;
  return `${frontMatter}\n\n${body}`;
}

/** The node definition; the editor kit adds the component. */
export const BaseFrontMatterPlugin = createSlatePlugin({
  key: FRONT_MATTER_KEY,
  node: { isElement: true, isVoid: true },
});
