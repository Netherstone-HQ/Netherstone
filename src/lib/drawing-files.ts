import type { FileTreeNode } from "@/store";

// ── Paths ─────────────────────────────────────────────────────────────────────

/** Excalidraw drawings live in the vault as `*.excalidraw` JSON files. */
export const DRAWING_EXTENSION = ".excalidraw";

export function isDrawingPath(filePath: string) {
  return /\.excalidraw$/i.test(filePath);
}

export function isMarkdownPath(filePath: string) {
  return /\.md$/i.test(filePath);
}

/** File name without the `.md` / `.excalidraw` extension, for display. */
export function getVaultFileDisplayName(fileName: string) {
  return fileName.replace(/\.(md|excalidraw)$/i, "");
}

/**
 * Attribute on an exported canvas image that names its source drawing, as a
 * vault-relative path with `/` separators.
 */
export const DRAWING_LINK_ATTRIBUTE = "data-excalidraw";

/** `filePath` relative to `vaultPath`, with `/` separators. */
export function toVaultRelativePath(filePath: string, vaultPath: string) {
  const file = normalizePath(filePath);
  const root = normalizePath(vaultPath).replace(/\/+$/, "");

  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

/** Absolute path of a vault-relative path, using the vault's separators. */
export function resolveVaultRelativePath(
  relativePath: string,
  vaultPath: string,
) {
  const separator = vaultPath.includes("\\") ? "\\" : "/";
  const root = vaultPath.replace(/[\\/]+$/, "");

  return `${root}${separator}${relativePath.split("/").join(separator)}`;
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

/** True when `filePath` is `parentPath` itself or lies inside it. */
export function isPathWithin(filePath: string, parentPath: string) {
  const file = normalizePath(filePath);
  const parent = normalizePath(parentPath).replace(/\/+$/, "");

  return file === parent || file.startsWith(`${parent}/`);
}

/**
 * Maps `filePath` to its new location after `oldPath` (a file or a folder
 * containing it) was renamed or moved to `newPath`. Returns null when
 * `filePath` was not affected.
 */
export function remapPathAfterMove(
  filePath: string,
  oldPath: string,
  newPath: string,
) {
  if (!isPathWithin(filePath, oldPath)) return null;

  // Normalizing separators keeps lengths, so the raw suffix can be reused.
  return `${newPath}${filePath.slice(oldPath.replace(/[\\/]+$/, "").length)}`;
}

export function flattenDrawingFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const drawings: FileTreeNode[] = [];

  const visit = (node: FileTreeNode) => {
    if (node.kind === "file") {
      if (isDrawingPath(node.path)) drawings.push(node);
      return;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return drawings;
}

// ── Pending saves ─────────────────────────────────────────────────────────────

type DrawingSaver = {
  /** Unsaved changes, or saved ones not yet in the drawing's exports. */
  hasPendingSave: () => boolean;
  flush: () => Promise<void>;
  /** Saves, then updates images exported from the drawing. */
  finish: () => Promise<void>;
};

let activeDrawingSaver: DrawingSaver | null = null;

/**
 * Registers the open canvas's saver so other code can flush its pending
 * autosave before the drawing is switched, renamed, moved, deleted or the
 * window closes. Returns an unregister function.
 */
export function registerDrawingSaver(saver: DrawingSaver) {
  activeDrawingSaver = saver;

  return () => {
    if (activeDrawingSaver === saver) {
      activeDrawingSaver = null;
    }
  };
}

export function hasPendingDrawingSave() {
  return activeDrawingSaver?.hasPendingSave() ?? false;
}

/** Immediately writes any unsaved changes to the open drawing. */
export async function flushPendingDrawingSave() {
  await activeDrawingSaver?.flush();
}

/**
 * Saves the open drawing and updates the images exported from it in shards,
 * for when the user leaves it.
 */
export async function finishDrawingSession() {
  await activeDrawingSaver?.finish();
}

// ── Exported images ───────────────────────────────────────────────────────────

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Builds the `<img>` tag for a canvas exported into a shard. */
export function buildDrawingImageTag({
  src,
  alt,
  width,
  drawingRef,
}: {
  src: string;
  alt: string;
  width: string;
  drawingRef: string | null;
}) {
  const attributes = [
    `src="${escapeHtmlAttribute(src)}"`,
    `alt="${escapeHtmlAttribute(alt)}"`,
    `width="${escapeHtmlAttribute(width)}"`,
    ...(drawingRef
      ? [`${DRAWING_LINK_ATTRIBUTE}="${escapeHtmlAttribute(drawingRef)}"`]
      : []),
  ];

  return `<img ${attributes.join(" ")} />`;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const LINKED_IMAGE_TAG = new RegExp(
  `<img\\b[^>]*\\s${DRAWING_LINK_ATTRIBUTE}="([^"]*)"[^>]*>`,
  "g",
);

/**
 * Calls `rewrite` for every image in `markdown` linked to a drawing, with the
 * tag and its decoded drawing reference. A returned string replaces the tag;
 * null leaves it. Returns null when nothing was replaced.
 */
function rewriteLinkedDrawingImages(
  markdown: string,
  rewrite: (tag: string, drawingRef: string) => string | null,
) {
  let replaced = false;

  const next = markdown.replace(LINKED_IMAGE_TAG, (tag, ref: string) => {
    const replacement = rewrite(tag, decodeHtmlAttribute(ref));
    if (replacement === null) return tag;

    replaced = true;
    return replacement;
  });

  return replaced ? next : null;
}

/**
 * Replaces every image in `markdown` linked to `drawingRef` with a fresh
 * export, keeping each image's width. Returns null when none is linked.
 */
export function replaceLinkedDrawingImages(
  markdown: string,
  drawingRef: string,
  buildTag: (width: string | null) => string,
) {
  return rewriteLinkedDrawingImages(markdown, (tag, ref) =>
    ref === drawingRef
      ? buildTag(/\swidth="([^"]*)"/.exec(tag)?.[1] ?? null)
      : null,
  );
}

/**
 * Points images linked to a drawing at its new path after the drawing, or a
 * folder containing it, was renamed or moved. Returns null when no image
 * was linked to it.
 */
export function relinkDrawingImages(
  markdown: string,
  oldRef: string,
  newRef: string,
) {
  return rewriteLinkedDrawingImages(markdown, (tag, ref) => {
    const remapped = remapPathAfterMove(ref, oldRef, newRef);
    if (remapped === null) return null;

    return tag.replace(
      new RegExp(`(\\s${DRAWING_LINK_ATTRIBUTE}=)"[^"]*"`),
      (_, name: string) => `${name}"${escapeHtmlAttribute(remapped)}"`,
    );
  });
}

/**
 * Text that appears in any shard linking to `drawingRef` or to a drawing
 * inside it (when it is a folder), as saved by export or by the editor.
 */
export function getDrawingLinkNeedles(drawingRef: string) {
  return [
    `${DRAWING_LINK_ATTRIBUTE}="${drawingRef}`,
    `${DRAWING_LINK_ATTRIBUTE}="${escapeHtmlAttribute(drawingRef)}`,
  ];
}
