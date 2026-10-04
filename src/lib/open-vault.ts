import { scanVault } from "@/lib/commands";
import { useVaultStore } from "@/store";

/** Makes `vaultPath` the open vault and reads its files. */
export async function openVault(vaultPath: string) {
  const { setCurrentVaultPath, setFileTree, setVaultLoading } =
    useVaultStore.getState();
  setCurrentVaultPath(vaultPath);
  setVaultLoading(true);
  try {
    setFileTree(await scanVault(vaultPath));
  } finally {
    setVaultLoading(false);
  }
}

/** `C:\Users\me\Documents\My Vault` → `My Vault`. */
export function folderName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/** Joins a file name onto a folder path, using the folder's own separator. */
export function joinPath(folder: string, name: string) {
  const separator = folder.includes("\\") ? "\\" : "/";
  return folder.replace(/[\\/]+$/, "") + separator + name;
}
