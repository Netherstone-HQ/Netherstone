import { finishDrawingSession, isDrawingPath } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { createDrawingFile, scanVault } from "@/lib/commands";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

/** Opens a `.excalidraw` drawing in canvas mode. */
export async function openDrawingFile(filePath: string) {
  const ui = useUIStore.getState();

  if (ui.activeDrawingPath !== filePath) {
    await finishDrawingSession();
    ui.openDrawing(filePath);
  }

  ui.setAppMode("canvas");
  ui.pushRecentFile({
    path: filePath,
    name: filePath.split(/[\\/]/).pop() ?? filePath,
  });
}

/**
 * Opens any file from the vault tree: drawings in canvas mode, shards in the
 * editor.
 */
export async function openVaultFile(filePath: string) {
  if (isDrawingPath(filePath)) {
    await openDrawingFile(filePath);
    return;
  }

  await openEditorFile(filePath);
}

/** Creates an untitled drawing at the root of the vault and opens it. */
export async function createDrawing(vaultPath: string) {
  const filePath = await createDrawingFile(vaultPath, "Untitled");
  await openDrawingFile(filePath);
  useVaultStore.getState().setFileTree(await scanVault(vaultPath));
}
