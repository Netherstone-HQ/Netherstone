import { invoke } from "@tauri-apps/api/core";
import type { PersistedAttachment } from "./attachments";
import { assertTauri } from "./tauri";

/** A file found for importing: its path, and its path under what was picked. */
export interface ImportSourceFile {
  path: string;
  relativePath: string;
  size: number;
}

/** Asks for files, or one folder, to import. Empty when cancelled. */
export async function pickImportPaths(folder: boolean): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("open_import_dialog", { folder });
}

/** Every file in the picked files and folders, hidden ones left out. */
export async function listImportSources(
  paths: string[],
): Promise<ImportSourceFile[]> {
  assertTauri();
  return invoke<ImportSourceFile[]>("list_import_sources", { paths });
}

export async function readImportFile(path: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_import_file", { path }));
}

/** Reads part of a file being imported, as raw bytes. */
export async function readImportFileRange(path: string, offset: number, length: number): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_import_file_range", { path, offset, length }));
}

/**
 * Takes an import back: its shards go to the trash like deleted ones, then
 * the attachments it brought in that nothing else links to. `since` is when
 * the import started, in unix seconds.
 */
export async function undoImport(
  vaultPath: string,
  targetDir: string,
  shardPaths: string[],
  assetPaths: string[],
  since: number,
): Promise<void> {
  assertTauri();
  await invoke("undo_import", { vaultPath, targetDir, shardPaths, assetPaths, since });
}

/** Free shard paths in `targetDir`, one per `Folder/Name`, never existing files. */
export async function reserveImportPaths(
  targetDir: string,
  relativePaths: string[],
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("reserve_import_paths", { targetDir, relativePaths });
}

/**
 * Writes an imported shard at `filePath`, or at the next free name when that
 * was taken since it was reserved. Returns where it went.
 */
export async function saveImportedShard(
  vaultPath: string,
  filePath: string,
  content: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("save_imported_shard", { vaultPath, filePath, content });
}

/** Points the links in `shardPaths` to `oldPath` at `newPath`. */
export async function fixImportedLinks(
  shardPaths: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  assertTauri();
  await invoke("fix_imported_links", { shardPaths, oldPath, newPath });
}

/** Copies a file an imported shard uses into the vault's attachments. */
export async function importAttachment(
  path: string,
  vaultPath: string,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("import_attachment", { path, vaultPath });
}
