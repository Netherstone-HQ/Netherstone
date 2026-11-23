import { flushPendingAutosave, writeLeftShardCaches } from "@/hooks/useAutosave";
import {
  finishPathChange,
  flushDrawingAffectedBy,
  persistOpenFileBeforePathChange,
  suppressPathChange,
} from "@/components/vault/path-change";
import { isPathWithin } from "@/lib/drawing-files";
import { deleteVaultPath, moveFile, renameFile } from "@/lib/commands/shards";
import { refreshVault } from "@/lib/refresh-vault";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import { useHistoryStore } from "@/store/history";

// Rename, move and delete for a file or folder, outside of any row, so a
// list can act on several at once. Each throws when it fails.

function openEditor() {
  const { currentFilePath, markdownContent, plateEditor, markSaved } =
    useEditorStore.getState();
  return { currentFilePath, markdownContent, plateEditor, markSaved };
}

function followers() {
  return {
    plateEditor: useEditorStore.getState().plateEditor,
    remapRememberedPaths: useUIStore.getState().remapRememberedPaths,
    currentVaultPath: useVaultStore.getState().currentVaultPath,
  };
}

async function changePath(
  node: FileTreeNode,
  reason: "rename" | "move",
  change: () => Promise<string>,
) {
  try {
    const persisted = await persistOpenFileBeforePathChange(node, reason, openEditor());
    await flushDrawingAffectedBy(node.path);
    suppressPathChange(node, null);
    useHistoryStore.getState().startPathChange(node.path);

    const newPath = await change();

    await finishPathChange(node, newPath, persisted, reason, followers());
  } catch (error) {
    console.error(`Failed to ${reason}:`, error);
    useHistoryStore.getState().endPathChange();
    throw error;
  }
}

/** Renames `node` to `name` in its folder. */
export function renameItem(node: FileTreeNode, name: string) {
  return changePath(node, "rename", () => renameFile(node.path, name));
}

/** Moves `node` into the folder at `destination`. */
export function moveItem(node: FileTreeNode, destination: string) {
  return changePath(node, "move", () => moveFile(node.path, destination));
}

/** Moves `node` to the trash, closing it first if it's open. */
export async function deleteItem(node: FileTreeNode) {
  const { currentFilePath, closeFile } = useEditorStore.getState();
  const deletesOpenFile =
    !!currentFilePath && isPathWithin(currentFilePath, node.path);

  try {
    await flushDrawingAffectedBy(node.path);
    // Let a save that is already running finish first, so it can't write
    // the shard back after it has gone to the trash.
    if (deletesOpenFile) await flushPendingAutosave();
    // So the cache rows go with it, not land after.
    await writeLeftShardCaches(node.path);

    await deleteVaultPath(node.path);

    const { activeDrawingPath, openDrawing, forgetRememberedPaths } =
      useUIStore.getState();
    if (activeDrawingPath && isPathWithin(activeDrawingPath, node.path)) {
      openDrawing(null);
    }

    forgetRememberedPaths(node.path);

    if (deletesOpenFile) closeFile();

    await refreshVault(useVaultStore.getState().currentVaultPath);
  } catch (error) {
    console.error("Failed to delete:", error);
    throw error;
  }
}
