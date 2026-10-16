import { toast } from "sonner";
import { finishDrawingSession, isDrawingPath } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { createDrawingFile, scanVault } from "@/lib/commands";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

/** Opens a `.excalidraw` drawing in Canvas. */
export async function openDrawingFile(filePath: string) {
  const ui = useUIStore.getState();

  if (ui.activeDrawingPath !== filePath) {
    await finishDrawingSession();
    ui.openDrawing(filePath);
  }

  ui.openMode("canvas");
  ui.pushRecentFile({
    path: filePath,
    name: filePath.split(/[\\/]/).pop() ?? filePath,
  });
}

/**
 * Opens any file from the vault: drawings in Canvas, shards in the Editor.
 */
export async function openVaultFile(filePath: string) {
  if (isDrawingPath(filePath)) {
    await openDrawingFile(filePath);
    return;
  }

  await openEditorFile(filePath);
  useUIStore.getState().openMode("editor");
}

/**
 * Creates an untitled drawing at the root of the vault and opens it, saying
 * so if that fails.
 */
export async function createDrawing(vaultPath: string) {
  try {
    const filePath = await createDrawingFile(vaultPath, "Untitled");
    await openDrawingFile(filePath);
    useVaultStore.getState().setFileTree(await scanVault(vaultPath));
  } catch (error) {
    console.error("[Netherstone] Failed to create drawing:", error);
    toast.error("Couldn't create drawing", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
