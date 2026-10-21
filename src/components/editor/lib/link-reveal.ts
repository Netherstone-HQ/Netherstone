import {
  KEYS,
  NodeApi,
  TextApi,
  type Path,
  type SlateEditor,
  type TRange,
} from "platejs";

import { scrollPlateToNode } from "@/lib/plate-toc-headings";

function linkText(node: Record<string, unknown>): string | null {
  if (node.type === KEYS.mention) {
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === KEYS.link) return NodeApi.string(node as never);
  return null;
}

/** The first @ link or link in the document whose text is `text`. */
export function findLinkByText(
  editor: SlateEditor,
  text: string,
): Path | undefined {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return undefined;

  const [entry] = editor.api.nodes({
    at: [],
    match: (node) =>
      linkText(node as Record<string, unknown>)?.trim().toLowerCase() ===
      wanted,
  });
  return entry?.[1];
}

/** A media node's source as the attachment report names it: `_attachments/…`. */
function attachmentPathOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let path = url.split(/[?#]/)[0].trim().replace(/\\/g, "/");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not encoded.
  }
  return path.replace(/^(\.\/|\/)+/, "");
}

/** The first embed of the attachment at `assetPath`, missing or not. */
export function findAttachment(
  editor: SlateEditor,
  assetPath: string,
): Path | undefined {
  const wanted = assetPath.toLowerCase();
  const [entry] = editor.api.nodes({
    at: [],
    match: (node) => {
      const path = attachmentPathOf(
        (node as Record<string, unknown>).url,
      )?.toLowerCase();
      return !!path && (path === wanted || path.endsWith(`/${wanted}`));
    },
  });
  return entry?.[1];
}

/** Scrolls to the first embed of the attachment at `assetPath`. */
export function revealAttachment(editor: SlateEditor, assetPath: string) {
  const path = findAttachment(editor, assetPath);
  if (!path) return;

  scrollPlateToNode(editor, path, () => editor.api.start(path));
}

/** Scrolls to the first link whose text is `text` and selects it. */
export function revealLinkByText(editor: SlateEditor, text: string) {
  const path = findLinkByText(editor, text);
  if (!path) return;

  // From just before the link to just after it: a selection inside an @ link
  // (a void) doesn't survive focusing the editor.
  scrollPlateToNode(editor, path, () => {
    const anchor = editor.api.before(path) ?? editor.api.start(path);
    const focus = editor.api.after(path) ?? editor.api.end(path);
    return anchor && focus ? { anchor, focus } : undefined;
  });
}

/** Punctuation a tag may end with, which isn't part of it (as `tags_in`). */
const TRAILING_PUNCTUATION = "[!-/:-@[-`{-~]*";

/** Where `#tag` is first written as a word, outside code. */
export function findTag(editor: SlateEditor, tag: string): TRange | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?<!\\S)#${escaped}(?=${TRAILING_PUNCTUATION}(?:\\s|$))`,
    "u",
  );

  for (const [node, path] of editor.api.nodes({ at: [], match: TextApi.isText })) {
    if (node.code) continue;
    if (editor.api.above({ at: path, match: { type: KEYS.codeBlock } })) continue;

    const match = pattern.exec(node.text as string);
    if (!match) continue;
    return {
      anchor: { path, offset: match.index },
      focus: { path, offset: match.index + match[0].length },
    };
  }
  return undefined;
}

/** Scrolls to the first `#tag` and selects it. */
export function revealTag(editor: SlateEditor, tag: string) {
  const range = findTag(editor, tag);
  if (!range) return;

  scrollPlateToNode(editor, range.anchor.path, () => range);
}
