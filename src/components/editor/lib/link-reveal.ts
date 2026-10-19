import { KEYS, NodeApi, type Path, type SlateEditor } from "platejs";

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
