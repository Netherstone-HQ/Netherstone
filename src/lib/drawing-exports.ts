import type {
  AppState,
  BinaryFiles,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import { findShardsContaining, persistAttachmentBytes } from "@/lib/commands";
import {
  buildDrawingImageTag,
  getDrawingLinkNeedles,
  getVaultFileDisplayName,
  relinkDrawingImages,
  replaceLinkedDrawingImages,
  toVaultRelativePath,
} from "@/lib/drawing-files";
import { rewriteShards } from "@/lib/shard-rewrite";

type ExportElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];

export interface ExportableScene {
  elements: ExportElements;
  appState: Partial<AppState>;
  files: BinaryFiles;
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function timestampedCanvasFileName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");

  return `excalidraw-canvas-${timestamp}.png`;
}

/**
 * Renders `scene` to a PNG with its export options, at least at 2x, and
 * stores it as an attachment in `vaultPath`.
 */
export async function persistScenePng(
  { elements, appState, files }: ExportableScene,
  vaultPath: string,
  name?: string,
) {
  const exportScale = Math.max(Number(appState.exportScale) || 1, 2);
  // Excalidraw is large; load it only when there is a drawing to export.
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    appState: { ...appState, exportScale },
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
    name ? `${name}.png` : timestampedCanvasFileName(),
    new Uint8Array(await blob.arrayBuffer()),
    vaultPath,
  );
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

  const attachment = await persistScenePng(
    scene,
    vaultPath,
    getDrawingAltText(drawingPath),
  );
  const buildTag = (width: string | null) =>
    buildDrawingImageTag({
      src: attachment.assetPath,
      alt: getDrawingAltText(drawingPath),
      width: width ?? "480",
      drawingRef,
    });

  return rewriteShards(shardPaths, (markdown) =>
    replaceLinkedDrawingImages(markdown, drawingRef, buildTag),
  );
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
