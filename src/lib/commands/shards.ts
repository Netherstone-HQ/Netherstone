import { invoke } from "@tauri-apps/api/core";

import type { TextPart } from "@/components/HighlightedText";
import type {
  Backlink,
  FileMetadata,
} from "@/components/sidebar/right-sidebar/types";
import { assertTauri } from "./tauri";

export async function readMarkdownFile(filePath: string): Promise<string> {
  assertTauri();
  return invoke<string>("read_markdown_file", { filePath });
}

/** How a save from the editor is made. */
export interface SaveMarkdownOptions {
  /** Counts toward the Overview page's writing. */
  recordWriting?: boolean;
  /** The text the file should still have; the save is refused otherwise. */
  expectedContent?: string;
}

/**
 * Atomically writes a shard and refreshes its attachment references.
 */
export async function saveMarkdownFile(
  filePath: string,
  content: string,
  options?: SaveMarkdownOptions,
): Promise<void> {
  assertTauri();
  return invoke("save_markdown_file", { filePath, content, ...options });
}

export async function appendMarkdownToFile(
  filePath: string,
  markdown: string,
): Promise<void> {
  assertTauri();
  return invoke("append_markdown_to_file", { filePath, markdown });
}

/** Makes the folder `parent/name`. */
export async function createFolder(parent: string, name: string): Promise<string> {
  assertTauri();
  return invoke<string>("create_folder", { parent, name });
}

/** Renames a file or folder in place and returns its new path. */
export async function renameFile(oldPath: string, newName: string): Promise<string> {
  assertTauri();
  return invoke<string>("rename_file", { oldPath, newName });
}

/** Moves a file or folder into `destinationDir` and returns its new path. */
export async function moveFile(
  sourcePath: string,
  destinationDir: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("move_file", { sourcePath, destinationDir });
}

/** Sends a file or folder in the vault to the trash. */
export async function deleteVaultPath(targetPath: string): Promise<void> {
  assertTauri();
  return invoke("delete_vault_path", { targetPath });
}

export interface SearchResult {
  path: string;
  name: string;
  /** The name without its extension, with the words searched for highlighted. */
  title: TextPart[];
  /** The text around the words searched for, which are highlighted. */
  snippet: TextPart[];
  /** The heading the snippet is under. */
  section: string | null;
  rank: number;
}

export async function searchFiles(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  assertTauri();
  return invoke<SearchResult[]>("search_files", { query, limit });
}

/** A shard's indexed details, or null when it isn't indexed. */
export async function getFileMetadata(
  filePath: string,
): Promise<FileMetadata | null> {
  assertTauri();
  return invoke<FileMetadata | null>("get_file_metadata", { filePath });
}

/** The shards that link to `filePath`. */
export async function getBacklinks(filePath: string): Promise<Backlink[]> {
  assertTauri();
  return invoke<Backlink[]>("get_backlinks", { filePath });
}
