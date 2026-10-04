import { scanVault } from "@/lib/commands";
import { useVaultStore } from "@/store/vault";

/** Makes `vaultPath` the open vault and loads its file tree. */
export async function switchVault(vaultPath: string) {
  const { setCurrentVaultPath, setFileTree, setVaultLoading } =
    useVaultStore.getState();
  setCurrentVaultPath(vaultPath);
  setVaultLoading(true);
  try {
    setFileTree(await scanVault(vaultPath));
  } catch (err) {
    console.error("[Netherstone] Failed to scan vault:", err);
  } finally {
    setVaultLoading(false);
  }
}
