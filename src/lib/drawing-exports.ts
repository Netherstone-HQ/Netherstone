import type {
  AppState,
  BinaryFiles,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  appendMarkdownToFile,
  findShardsContaining,
  persistAttachmentBytes,
  readDrawingFile,
  readMarkdownFile,
  saveMarkdownFile,
  staleDrawingPictures,
} from "@/lib/commands";
import {
  buildDrawingImageTag,
  getDrawingLinkNeedles,
  getLinkedDrawingSources,
  getVaultFileDisplayName,
  relinkDrawingImages,
  replaceLinkedDrawingImages,
  resolveVaultRelativePath,
  toVaultRelativePath,
} from "@/lib/drawing-files";
import { getFilesystemPathFromMediaSource } from "@/lib/media-source";
import { openEditorFile } from "@/lib/open-editor-file";
import { rewriteShards } from "@/lib/shard-rewrite";
import { useEditorStore } from "@/store/editor";

type ExportElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];

export interface ExportableScene {
  elements: ExportElements;
  appState: Partial<AppState>;
  files: BinaryFiles;
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Parses a `.excalidraw` file into restored scene data. */
export async function parseDrawing(json: string) {
  const data = json.trim() ? JSON.parse(json) : {};

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("The file is not an Excalidraw drawing.");
  }

  // Excalidraw is large; load it only when a drawing is read.
  const { restore } = await import("@excalidraw/excalidraw");
  return restore(
    {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState: data.appState ?? {},
      files: data.files ?? {},
    },
    null,
    null,
  );
}

/** The scene saved in the drawing at `drawingPath`. */
export async function readDrawingScene(
  drawingPath: string,
): Promise<ExportableScene> {
  return parseDrawing(await readDrawingFile(drawingPath));
}

/**
 * Renders `scene` to a PNG with its export options, at least at 2x, and
 * stores it as an attachment in `vaultPath`.
 */
async function persistScenePng(
  { elements, appState, files }: ExportableScene,
  vaultPath: string,
  name: string,
  dark: boolean,
) {
  const exportScale = Math.max(Number(appState.exportScale) || 1, 2);
  // Excalidraw is large; load it only when there is a drawing to export.
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    appState: { ...appState, exportScale, exportWithDarkMode: dark },
    elements: elements.filter((element) => !element.isDeleted),
    files,
    getDimensions: (width: number, height: number) => ({
      height: height * exportScale,
      scale: exportScale,
      width: width * exportScale,
    }),
    mimeType: "image/png",
  });

  return persistAttachmentBytes(
    `${name}.png`,
    new Uint8Array(await blob.arrayBuffer()),
    vaultPath,
  );
}

/**
 * The image tag for `scene` exported from `drawingPath`, light and dark, so
 * the drawing reads the same as on the canvas in either theme.
 */
async function exportDrawingImages(
  scene: ExportableScene,
  drawingPath: string,
  vaultPath: string,
) {
  const alt = getDrawingAltText(drawingPath);
  const light = await persistScenePng(scene, vaultPath, alt, false);
  const dark = await persistScenePng(scene, vaultPath, `${alt}-dark`, true);
  const drawingRef = toVaultRelativePath(drawingPath, vaultPath);

  return (width: string | null) =>
    buildDrawingImageTag({
      src: light.assetPath,
      darkSrc: dark.assetPath,
      alt,
      width: width ?? "480",
      drawingRef,
    });
}

/** Alt text for an image exported from `drawingPath`. */
export function getDrawingAltText(drawingPath: string) {
  return getVaultFileDisplayName(getFileName(drawingPath));
}

function findLinkingShards(vaultPath: string, drawingRef: string) {
  return findShardsContaining(vaultPath, getDrawingLinkNeedles(drawingRef));
}

/**
 * Re-exports `scene` into every image linked to the drawing at
 * `drawingPath`, keeping each image's width. Returns how many shards were
 * updated; nothing is rendered when no shard links to the drawing.
 */
export async function refreshLinkedDrawingImages(
  drawingPath: string,
  vaultPath: string,
  scene: ExportableScene,
) {
  const drawingRef = toVaultRelativePath(drawingPath, vaultPath);
  const shardPaths = await findLinkingShards(vaultPath, drawingRef);
  if (shardPaths.length === 0) return 0;

  const buildTag = await exportDrawingImages(scene, drawingPath, vaultPath);

  return rewriteShards(shardPaths, (markdown) =>
    replaceLinkedDrawingImages(markdown, drawingRef, buildTag),
  );
}

let fillChain = Promise.resolve();

/**
 * Exports the pictures in the shard at `shardPath` that are missing or older
 * than their drawing, such as a drawing written while the app was closed.
 * Only the drawings `markdown` shows are checked and only this shard is
 * updated, so the cost stays with the shard; other shards showing the same
 * drawing catch up when they open.
 */
export function fillDrawingPictures(
  shardPath: string,
  markdown: string,
  vaultPath: string,
) {
  const linked = getLinkedDrawingSources(markdown);
  if (linked.size === 0) return fillChain;

  // One at a time, so reopening the shard after filling it doesn't export
  // the same pictures again.
  fillChain = fillChain
    .then(() => fillStalePictures(shardPath, linked, vaultPath))
    .catch((error) => {
      console.error("[Netherstone] Failed to fill in drawing pictures:", error);
    });
  return fillChain;
}

async function fillStalePictures(
  shardPath: string,
  linked: Map<string, (string | null)[]>,
  vaultPath: string,
) {
  const refsByPath = new Map<string, string>();
  const drawings = [...linked].map(([drawingRef, sources]) => {
    const drawingPath = resolveVaultRelativePath(drawingRef, vaultPath);
    refsByPath.set(drawingPath, drawingRef);
    return {
      drawingPath,
      imagePaths: sources.map((source) =>
        getFilesystemPathFromMediaSource(source, { vaultPath }),
      ),
    };
  });

  const builders = new Map<string, (width: string | null) => string>();
  for (const drawingPath of await staleDrawingPictures(vaultPath, drawings)) {
    try {
      const scene = await readDrawingScene(drawingPath);
      // Keep the last picture rather than replacing it with an empty one.
      if (!scene.elements.some((element) => !element.isDeleted)) continue;

      builders.set(
        refsByPath.get(drawingPath)!,
        await exportDrawingImages(scene, drawingPath, vaultPath),
      );
    } catch (error) {
      // A drawing that can't be read keeps its picture; the others still fill.
      console.error(`[Netherstone] Failed to export ${drawingPath}:`, error);
    }
  }
  if (builders.size === 0) return;

  await rewriteShards([shardPath], (markdown) => {
    let next: string | null = null;
    for (const [drawingRef, buildTag] of builders) {
      next =
        replaceLinkedDrawingImages(next ?? markdown, drawingRef, buildTag) ??
        next;
    }
    return next;
  });
}

/**
 * Adds `scene` to the end of the shard at `shardPath` as an image linked to
 * its drawing, so the image follows later changes to the drawing. A shard
 * that already shows the drawing gets its image replaced instead. Returns
 * whether the image was added or replaced.
 */
export async function addDrawingToShard(
  scene: ExportableScene,
  drawingPath: string,
  shardPath: string,
  vaultPath: string,
): Promise<"added" | "replaced"> {
  const drawingRef = toVaultRelativePath(drawingPath, vaultPath);
  const buildTag = await exportDrawingImages(scene, drawingPath, vaultPath);

  // Save the open shard's edits first, so they are part of what is read.
  await flushPendingAutosave();

  const replaced = replaceLinkedDrawingImages(
    await readMarkdownFile(shardPath),
    drawingRef,
    buildTag,
  );
  if (replaced !== null) {
    await saveMarkdownFile(shardPath, replaced);
  } else {
    await appendMarkdownToFile(shardPath, buildTag(null));
  }

  // Reload the open shard, so the editor shows the image and doesn't save
  // over it.
  if (useEditorStore.getState().currentFilePath === shardPath) {
    await openEditorFile(shardPath);
  }

  return replaced !== null ? "replaced" : "added";
}

/**
 * Points images linked to a drawing, or to drawings in a folder, at its new
 * path after a rename or move.
 */
export async function relinkDrawingReferences(
  oldPath: string,
  newPath: string,
  vaultPath: string,
) {
  const oldRef = toVaultRelativePath(oldPath, vaultPath);
  const newRef = toVaultRelativePath(newPath, vaultPath);
  if (oldRef === newRef) return 0;

  return rewriteShards(await findLinkingShards(vaultPath, oldRef), (markdown) =>
    relinkDrawingImages(markdown, oldRef, newRef),
  );
}
