import { flushPendingAutosave } from "@/hooks/useAutosave";
import { readMarkdownFile, saveMarkdownFile } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store/editor";

/**
 * Applies `rewrite` to each of `shardPaths` and saves the ones it changed,
 * reloading the open shard so the editor shows the new text and does not
 * save over it. Returns how many shards changed.
 */
export async function rewriteShards(
  shardPaths: string[],
  rewrite: (markdown: string, shardPath: string) => string | null,
) {
  if (shardPaths.length === 0) return 0;

  // Save the open shard's edits first, so they are part of what is read.
  await flushPendingAutosave();

  let changed = 0;
  for (const shardPath of shardPaths) {
    const next = rewrite(await readMarkdownFile(shardPath), shardPath);
    if (next === null) continue;

    await saveMarkdownFile(shardPath, next);
    changed += 1;

    if (useEditorStore.getState().currentFilePath === shardPath) {
      await openEditorFile(shardPath);
    }
  }

  return changed;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Points every link to `oldPath` in `markdown` at `newPath`: markdown link
 * and image destinations (wrapped in `<>` when the new path has spaces) and
 * quoted HTML attributes. Returns null when nothing linked to it.
 */
export function replaceAttachmentPath(
  markdown: string,
  oldPath: string,
  newPath: string,
) {
  const newDestination = /[\s()]/.test(newPath) ? `<${newPath}>` : newPath;
  const forms = [...new Set([oldPath, encodeURI(oldPath)])].map(escapeRegExp);
  const attributeForms = [
    ...new Set([oldPath, encodeURI(oldPath), escapeHtmlAttribute(oldPath)]),
  ].map(escapeRegExp);
  let next = markdown;

  for (const form of forms) {
    next = next
      .replace(new RegExp(`\\]\\(<${form}>`, "g"), () => `](<${newPath}>`)
      .replace(
        new RegExp(`\\]\\(${form}(?=[\\s)])`, "g"),
        () => `](${newDestination}`,
      );
  }
  for (const form of attributeForms) {
    next = next.replace(
      new RegExp(`="${form}"`, "g"),
      () => `="${escapeHtmlAttribute(newPath)}"`,
    );
  }

  return next === markdown ? null : next;
}

/** Points the links to an attachment in `shardPaths` at its new path. */
export function relinkAttachment(
  shardPaths: string[],
  oldPath: string,
  newPath: string,
) {
  return rewriteShards(shardPaths, (markdown) =>
    replaceAttachmentPath(markdown, oldPath, newPath),
  );
}

/**
 * Points a link to a file outside the attachment folder at its imported
 * copy, and marks media tags that used it as vault attachments.
 */
export function importLinkedFile(
  markdown: string,
  link: string,
  assetPath: string,
) {
  const next = replaceAttachmentPath(markdown, link, assetPath);
  if (next === null) return null;

  const newAttribute = `="${escapeHtmlAttribute(assetPath)}"`;
  return next.replace(/<[a-zA-Z][^>]*>/g, (tag) =>
    tag.includes(newAttribute)
      ? tag.replace(
          /\snetherstoneSourceKind="local"/,
          ' netherstoneSourceKind="vault"',
        )
      : tag,
  );
}
