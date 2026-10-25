import { invoke } from "@tauri-apps/api/core";

import { isPathWithin } from "@/lib/drawing-files";

export type GalleryKind =
  | "image"
  | "drawing"
  | "pdf"
  | "audio"
  | "video"
  | "other";

/** A sidebar row: every file, one kind, or the files no shard uses. */
export type GalleryRow = "all" | GalleryKind | "unused";

export interface GalleryFile {
  /** Vault-relative, like `_attachments/Trip.jpg`. */
  assetPath: string;
  /** A drawing's dark export, shown instead in dark themes. */
  darkAssetPath: string | null;
  name: string;
  kind: GalleryKind;
  /** With the dark export, if there is one. */
  sizeBytes: number;
  /** Seconds since the epoch. */
  addedAt: number;
  /** The shards that use the file, sorted. Empty when none does. */
  shardPaths: string[];
}

/** The kinds in sidebar order, with their labels. */
export const GALLERY_KINDS: { kind: GalleryKind; label: string }[] = [
  { kind: "image", label: "Images" },
  { kind: "drawing", label: "Drawings" },
  { kind: "pdf", label: "PDFs" },
  { kind: "audio", label: "Audio" },
  { kind: "video", label: "Video" },
  { kind: "other", label: "Other files" },
];

/** Every file in the open vault's attachment folder, newest added first. */
export function listAttachments(vaultPath: string) {
  return invoke<GalleryFile[]>("list_attachments", { vaultPath });
}

export function isUnused(file: GalleryFile) {
  return file.shardPaths.length === 0;
}

export function filesInRow(files: GalleryFile[], row: GalleryRow) {
  if (row === "all") return files;
  if (row === "unused") return files.filter(isUnused);
  return files.filter((file) => file.kind === row);
}

export function getRowTitle(row: GalleryRow) {
  if (row === "all") return "All files";
  if (row === "unused") return "Not used";
  return GALLERY_KINDS.find(({ kind }) => kind === row)?.label ?? "All files";
}

/** Whether a file's name has what's typed in Filter files. */
export function matchesFileFilter(file: GalleryFile, filter: string) {
  return file.name.toLowerCase().includes(filter.trim().toLowerCase());
}

/** True for a file in the vault's attachment folder. */
export function isAttachmentPath(filePath: string, vaultPath: string) {
  return isPathWithin(filePath, `${vaultPath.replace(/[\\/]+$/, "")}/_attachments`);
}

/**
 * True when a `vault:changed` event only names attachment files, which
 * leave shards, drawings and the file tree as they were.
 */
export function isAttachmentOnlyChange(paths: string[], vaultPath: string) {
  return (
    paths.length > 0 && paths.every((path) => isAttachmentPath(path, vaultPath))
  );
}
