import { invoke } from "@tauri-apps/api/core";

import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

/** The history of a vault whose folder is gone. */
export type GoneVaultHistory = {
  vaultId: string;
  name: string;
  path: string;
  sizeBytes: number;
};

/**
 * Forgets the vaults whose folder is gone: what the app keeps for them and
 * can make again, their place in the recent vaults, and their recent and
 * pinned files. Their history stays until it's deleted in Settings.
 */
export async function forgetGoneVaults() {
  const gone = await invoke<string[]>("forget_gone_vaults", {
    recent: useVaultStore.getState().recentVaults,
  });
  for (const path of gone) {
    useVaultStore.getState().forgetRecentVault(path);
    useUIStore.getState().forgetRememberedPaths(path);
  }
}

export function listGoneVaultHistories() {
  return invoke<GoneVaultHistory[]>("gone_vault_histories");
}

/** Moves a gone vault's history to the trash. Resolves to the bytes freed. */
export function deleteGoneVaultHistory(vaultId: string) {
  return invoke<number>("delete_gone_vault_history", { vaultId });
}
