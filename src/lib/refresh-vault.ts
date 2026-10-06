import { invoke } from "@tauri-apps/api/core";

import { useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";

/** Rebuilds the file tree and search index after the app changes the vault. */
export async function refreshVault(currentVaultPath: string | null) {
  if (!currentVaultPath) return;

  const fileTree = await invoke<FileTreeNode[]>("scan_vault", {
    vaultPath: currentVaultPath,
  });

  useVaultStore.getState().setFileTree(fileTree);
  await invoke("index_vault", { vaultPath: currentVaultPath });
}
