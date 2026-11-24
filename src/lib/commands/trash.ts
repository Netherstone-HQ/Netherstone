import { invoke } from "@tauri-apps/api/core";

import { assertTauri } from "./tauri";

/** A file or folder deleted on a phone, kept in the app's trash. */
export interface TrashedItem {
  /** What the other trash commands take. */
  id: string;
  name: string;
  /** The path it had, where Restore puts it back. */
  from: string;
  isFolder: boolean;
  /** Milliseconds since 1970. */
  deletedAt: number;
  bytes: number;
}

/** What's in the app's trash from the open vault, newest first. */
export async function listAppTrash(): Promise<TrashedItem[]> {
  assertTauri();
  return invoke<TrashedItem[]>("list_app_trash");
}

/** Puts trash items back where they were. Returns where each one went. */
export async function restoreAppTrash(ids: string[]): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("restore_app_trash", { ids });
}

/** Deletes trash items for good. */
export async function deleteAppTrash(ids: string[]): Promise<void> {
  assertTauri();
  return invoke("delete_app_trash", { ids });
}
