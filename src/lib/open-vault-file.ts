import { toast } from "sonner";
import {
  fileName,
  finishDrawingSession,
  getParentFolder,
  isDrawingPath,
  isPathWithin,
  isSamePath,
} from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { createDrawingFile } from "@/lib/commands/drawings";
import { createShardFile } from "@/lib/commands/shards";
import { scanVault } from "@/lib/commands/vault";
import { refreshVault } from "@/lib/refresh-vault";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { errorText } from "@/lib/utils";

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
    name: fileName(filePath),
  });
}

/** Whether `filePath` is the shard in the Editor, or the one opening. */
function isShardOpen(filePath: string) {
  const { currentFilePath, openingFilePath } = useEditorStore.getState();
  const openPath = openingFilePath ?? currentFilePath;
  return openPath !== null && isSamePath(openPath, filePath);
}

/**
 * Opens any file from the vault: drawings in Canvas, shards in the Editor.
 * The shard already open stays as it is.
 */
export async function openVaultFile(filePath: string) {
  if (isDrawingPath(filePath)) {
    await openDrawingFile(filePath);
    return;
  }

  if (isShardOpen(filePath)) {
    const { deletedPath, closeHistory } = useHistoryStore.getState();
    if (deletedPath !== null) closeHistory();
  } else {
    await openEditorFile(filePath);
  }
  useUIStore.getState().openMode("editor");
}

/** Opens a shard or drawing with its history beside it. */
export async function openFileHistory(filePath: string) {
  await openVaultFile(filePath);
  useHistoryStore
    .getState()
    .openHistory(isDrawingPath(filePath) ? "canvas" : "notes");
}

/** Shows a deleted shard's history in the Editor, its last version on screen. */
export function openDeletedShardHistory(filePath: string) {
  useUIStore.getState().openMode("editor");
  useHistoryStore.getState().openDeletedHistory(filePath);
}

/**
 * Creates an untitled drawing in `folder` (the vault's root by default) and
 * opens it, saying so if that fails. Returns its path, or null then.
 */
export async function createDrawing(
  vaultPath: string,
  folder = vaultPath,
): Promise<string | null> {
  try {
    const filePath = await createDrawingFile(folder, "Untitled");
    await openDrawingFile(filePath);
    useVaultStore.getState().setFileTree(await scanVault(vaultPath));
    return filePath;
  } catch (error) {
    console.error("[Netherstone] Failed to create drawing:", error);
    toast.error("Couldn't create drawing", {
      description: errorText(error),
    });
    return null;
  }
}

/** The vault root, or the open shard's folder when Settings asks for it. */
function newShardFolder(vaultPath: string): string {
  const openPath = useEditorStore.getState().currentFilePath;
  if (
    useSettingsStore.getState().newShardLocation !== "current-folder" ||
    !openPath ||
    !isPathWithin(openPath, vaultPath)
  ) {
    return vaultPath;
  }
  const folder = getParentFolder(openPath);
  return folder || vaultPath;
}

/**
 * Puts the cursor in the shard at `filePath` once its editor is on screen.
 * Gives up when another shard opens first.
 */
function focusWhenShown(filePath: string) {
  const shown = useEditorStore.getState().plateEditor;
  const unsubscribe = useEditorStore.subscribe((state) => {
    const opening = state.openingFilePath ?? state.currentFilePath;
    if (opening !== filePath) {
      unsubscribe();
      return;
    }
    const editor = state.plateEditor;
    if (state.currentFilePath !== filePath || !editor || editor === shown) return;
    unsubscribe();
    window.requestAnimationFrame(() => editor.tf.focus());
  });
}

/**
 * Creates an empty "Untitled" shard in `folder` and opens it ready to type,
 * saying so if that fails. Without `folder`, Settings decides where it goes.
 */
export async function createShard(vaultPath: string, folder?: string) {
  try {
    const filePath = await createShardFile(folder ?? newShardFolder(vaultPath));
    focusWhenShown(filePath);
    await openEditorFile(filePath);
    // New shard works from any mode; the shard opens in the editor.
    useUIStore.getState().openMode("editor");
    await refreshVault(vaultPath);
  } catch (error) {
    console.error("[Netherstone] Failed to create shard:", error);
    toast.error("Couldn't create shard", {
      description: errorText(error),
    });
  }
}
