import { invoke } from "@tauri-apps/api/core";
import type { PersistedAttachment } from "./attachments";
import { assertTauri } from "./tauri";

/** A file another app shared: its name, its type ("" when unknown) and where it waits. */
export interface SharedFile {
  name: string;
  type: string;
  path: string;
}

/** Text, a link or files another app shared with Netherstone on a phone. */
export interface Shared {
  text: string | null;
  subject: string | null;
  files: SharedFile[];
}

/** The latest share since the last take; its files can then go to `saveSharedFile`. */
export async function takeShared(): Promise<Shared | null> {
  assertTauri();
  return invoke<Shared | null>("take_shared");
}

/** Copies a file of the latest share into the vault's attachments. */
export async function saveSharedFile(
  path: string,
  vaultPath: string,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("save_shared_file", { path, vaultPath });
}
