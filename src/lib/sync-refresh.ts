import { flushPendingAutosave } from "@/hooks/useAutosave";
import { fileExists, scanVault } from "@/lib/commands";
import {
  flushPendingDrawingSave,
  isSamePath,
  reloadOpenDrawingIfChanged,
  resolveVaultRelativePath,
} from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

function normalize(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Saves pending edits, to the open shard and drawing, so the next sync
 * includes them. Returns `false` when the open shard still has unsaved
 * changes, in which case syncing waits.
 */
export async function prepareForSync() {
  await Promise.all([flushPendingAutosave(), flushPendingDrawingSave()]);
  return !useEditorStore.getState().isDirty;
}

/**
 * Shows changes that sync wrote into the vault: refreshes the file tree,
 * reloads the open shard if it changed (or closes it if it was removed), and
 * merges changes to the open drawing into it.
 */
export async function showSyncedChanges(vaultPath: string, changed: string[]) {
  if (changed.length === 0) return;

  const vault = useVaultStore.getState();
  if (vault.currentVaultPath !== vaultPath) return;
  vault.setFileTree(await scanVault(vaultPath));

  const drawingPath = useUIStore.getState().activeDrawingPath;
  if (
    drawingPath &&
    changed.some((path) =>
      isSamePath(resolveVaultRelativePath(path, vaultPath), drawingPath),
    )
  ) {
    await reloadOpenDrawingIfChanged();
  }

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
