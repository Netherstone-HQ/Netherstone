import { flushPendingAutosave } from "@/hooks/useAutosave";
import { renameVaultFolder } from "@/lib/commands/vault";
import { flushPendingDrawingSave, remapPathAfterMove } from "@/lib/drawing-files";
import {
  applyOpenEditorSessionPathChange,
  captureOpenEditorSessionPathChangeSnapshot,
} from "@/lib/open-editor-session-path-change";
import { openVault } from "@/lib/open-vault";
import { finishVoiceNoteBeforeLeaving } from "@/lib/voice/voice-note";
import { remapShardLinkKeys } from "@/lib/shard-link-keys";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";

/**
 * Renames the open vault's folder to `name`. The open shard and drawing are
 * saved first, and stay open at their new paths after, as do the recent and
 * pinned files, open folders and the vault's place among the recent vaults.
 */
export async function renameVault(name: string) {
  const previousPath = useVaultStore.getState().currentVaultPath;
  if (!previousPath) return;

  // The recording's file goes in the vault, so it's saved before the move.
  await finishVoiceNoteBeforeLeaving();
  await flushPendingAutosave();
  await flushPendingDrawingSave();
  if (useEditorStore.getState().isDirty) {
    throw new Error("Couldn't save the open shard. Try again.");
  }

  const nextPath = await renameVaultFolder(previousPath, name);
  if (nextPath === previousPath) return;

  const { currentFilePath, markdownContent, plateEditor } =
    useEditorStore.getState();
  const openPath = currentFilePath
    ? remapPathAfterMove(currentFilePath, previousPath, nextPath)
    : null;
  if (openPath) {
    applyOpenEditorSessionPathChange(
      openPath,
      markdownContent,
      captureOpenEditorSessionPathChangeSnapshot(plateEditor),
    );
  }
  if (plateEditor) remapShardLinkKeys(plateEditor, previousPath, nextPath);

  const ui = useUIStore.getState();
  const drawingPath = ui.activeDrawingPath
    ? remapPathAfterMove(ui.activeDrawingPath, previousPath, nextPath)
    : null;
  if (drawingPath) ui.setActiveDrawingPath(drawingPath);
  ui.remapRememberedPaths(previousPath, nextPath);

  useVaultStore.getState().renameVault(previousPath, nextPath);
  await openVault(nextPath);
}
