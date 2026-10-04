import { flushPendingAutosave } from "@/hooks/useAutosave";
import { fileExists, scanVault } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

function normalize(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Saves pending edits so the next sync includes them. Returns `false` when
 * the open file still has unsaved changes, in which case syncing waits.
 */
export async function prepareForSync() {
  await flushPendingAutosave();
  return !useEditorStore.getState().isDirty;
}

/**
 * Shows changes that sync wrote into the vault: refreshes the file tree and
 * reloads the open file if it changed (or closes it if it was removed).
 */
export async function showSyncedChanges(vaultPath: string, changed: string[]) {
  if (changed.length === 0) return;

  const vault = useVaultStore.getState();
  if (vault.currentVaultPath !== vaultPath) return;
  vault.setFileTree(await scanVault(vaultPath));

  const openPath = useEditorStore.getState().currentFilePath;
  if (!openPath) return;
  const openRelative = normalize(openPath).slice(normalize(vaultPath).length + 1);
  if (!changed.some((path) => normalize(path) === openRelative)) return;

  if (await fileExists(openPath)) {
    await openEditorFile(openPath);
  } else {
    useEditorStore.getState().closeFile();
  }
}
