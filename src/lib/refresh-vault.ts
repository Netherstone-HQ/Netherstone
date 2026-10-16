import { invoke } from "@tauri-apps/api/core";

import { useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import { useTagsStore } from "@/store/tags";

/** Brings the vault's search index up to date; Tags reloads on its next visit. */
export async function indexVault(vaultPath: string) {
  const result = await invoke<string>("index_vault", { vaultPath });
  useTagsStore.getState().invalidate();
  return result;
}

/** Rebuilds the file tree and search index after the app changes the vault. */
export async function refreshVault(currentVaultPath: string | null) {
  if (!currentVaultPath) return;

  const fileTree = await invoke<FileTreeNode[]>("scan_vault", {
    vaultPath: currentVaultPath,
  });

  useVaultStore.getState().setFileTree(fileTree);
  await indexVault(currentVaultPath);
}
