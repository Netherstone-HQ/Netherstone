import { flushPendingAutosave } from "@/hooks/useAutosave";
import { scanVault, setOpenVault } from "@/lib/commands";
import { isPathWithin } from "@/lib/drawing-files";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";

/**
 * Makes `vaultPath` the open vault and reads its files. A shard or drawing
 * still open from another vault is closed, so the app doesn't come back on
 * the old vault's work.
 */
export async function openVault(vaultPath: string) {
  const { setCurrentVaultPath, setFileTree, setVaultLoading } =
    useVaultStore.getState();
  await closeFilesOutside(vaultPath);
  await setOpenVault(vaultPath);
  setCurrentVaultPath(vaultPath);
  setVaultLoading(true);
  try {
    setFileTree(await scanVault(vaultPath));
  } finally {
    setVaultLoading(false);
  }
}

/**
 * Opens the vault the app was last on in Rust, before anything asks for its
 * files. One that can't open any more is cleared when the app scans it.
 */
export async function reopenLastVault() {
  const { currentVaultPath } = useVaultStore.getState();
  if (!currentVaultPath) return;
  await setOpenVault(currentVaultPath).catch((error) =>
    console.warn("[Netherstone] Couldn't reopen the vault:", error),
  );
}

async function closeFilesOutside(vaultPath: string) {
  const ui = useUIStore.getState();
  if (ui.activeDrawingPath && !isPathWithin(ui.activeDrawingPath, vaultPath)) {
    ui.openDrawing(null);
  }

  const openPath = useEditorStore.getState().currentFilePath;
  if (!openPath || isPathWithin(openPath, vaultPath)) return;
  await flushPendingAutosave().catch(() => {});
  // Edits that couldn't be saved stay open rather than being lost.
  if (!useEditorStore.getState().isDirty) useEditorStore.getState().closeFile();
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
