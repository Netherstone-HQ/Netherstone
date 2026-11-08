import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode } from "@/store";
import { assertTauri } from "./tauri";

/**
 * Opens the native OS folder picker dialog.
 * Returns the selected folder path, or null if the user cancelled.
 */
export async function openVaultDialog(): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("open_vault_dialog");
}

/**
 * Makes `vaultPath` the open vault on the Rust side, which refuses to touch
 * files anywhere else. It must be a vault already, or a folder just picked
 * or created.
 */
export async function setOpenVault(vaultPath: string): Promise<void> {
  assertTauri();
  return invoke("open_vault", { vaultPath });
}

/**
 * Recursively scans a vault directory for .md and .excalidraw files and returns the
 * file tree sorted with directories first, then files, both alphabetically.
 */
export async function scanVault(vaultPath: string): Promise<FileTreeNode[]> {
  assertTauri();
  return invoke<FileTreeNode[]>("scan_vault", { vaultPath });
}

/** Another vault that a folder is inside, or that is inside it. */
export type NestedVault = {
  path: string;
  /** The folder is inside this vault; otherwise this vault is inside it. */
  containsFolder: boolean;
};

/**
 * Another vault around or inside `folder`, which may not exist yet, or null
 * when there is none.
 */
export async function findNestedVault(
  folder: string,
): Promise<NestedVault | null> {
  assertTauri();
  return invoke<NestedVault | null>("find_nested_vault", { folder });
}

/** The folder new vaults go in unless the user picks another: Documents. */
export async function defaultVaultLocation(): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("default_vault_location");
}

/**
 * Creates the folder for a new vault in `parent` and returns its path. Fails
 * with one of the codes in `VaultFolderError` instead of a sentence.
 */
export async function createVault(parent: string, name: string): Promise<string> {
  assertTauri();
  return invoke<string>("create_vault", { parent, name });
}

export type VaultFolderError =
  | "vault-name-empty"
  | "vault-name-invalid"
  | "vault-folder-not-empty"
  | "vault-location-missing";

/** Free space, in bytes, on the disk the open vault is on. */
export async function vaultFreeSpace(vaultPath: string): Promise<number> {
  assertTauri();
  return invoke<number>("vault_free_space", { vaultPath });
}

/**
 * Starts a debounced file watcher on the given vault directory.
 * Fires a `vault:changed` event whenever .md or .excalidraw files, folders,
 * or files in `_attachments` are added, removed, or renamed.
 */
export async function startVaultWatcher(vaultPath: string): Promise<void> {
  assertTauri();
  return invoke("start_vault_watcher", { vaultPath });
}

/**
 * Stops the active file watcher, if any.
 */
export async function stopVaultWatcher(): Promise<void> {
  assertTauri();
  return invoke("stop_vault_watcher");
}
