import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { fileExists } from "@/lib/commands/attachments";
import {
  scanVault,
  startVaultWatcher,
  stopVaultWatcher,
} from "@/lib/commands/vault";
import {
  isPathWithin,
  isSamePath,
  reloadOpenDrawingIfChanged,
} from "@/lib/drawing-files";
import { isAttachmentOnlyChange, isAttachmentPath } from "@/lib/gallery";
import { reloadOpenShardIfChanged } from "@/lib/outside-changes";
import { partitionSuppressedVaultChangePaths } from "@/lib/vault-change-suppression";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import { useGalleryStore } from "@/store/gallery";

type VaultChangedPayload = {
  paths?: string[];
};

/**
 * Watches the open vault's folder and rescans it when files change outside
 * the app. An open shard that was deleted or moved is closed, so the next
 * edit doesn't write it back; an open shard or drawing that changed shows
 * the new text. Changed attachments only reload the Gallery.
 */
export function useVaultWatcher() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const setFileTree = useVaultStore((s) => s.setFileTree);

  useEffect(() => {
    if (!currentVaultPath) return;

    const path = currentVaultPath;
    // Set once the vault changes, so late events are ignored.
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    startVaultWatcher(path).catch((err) =>
      console.error("[Netherstone] Failed to start vault watcher:", err),
    );

    listen<VaultChangedPayload>("vault:changed", async (event) => {
      if (cancelled) return;

      const changedPaths = Array.isArray(event.payload?.paths)
        ? event.payload.paths.filter(
            (filePath): filePath is string =>
              typeof filePath === "string" && filePath.trim().length > 0,
          )
        : [];

      if (
        changedPaths.length === 0 ||
        changedPaths.some((filePath) => isAttachmentPath(filePath, path))
      ) {
        useGalleryStore.getState().invalidate();
      }
      if (isAttachmentOnlyChange(changedPaths, path)) return;

      if (changedPaths.length > 0) {
        const { unsuppressedPaths } =
          partitionSuppressedVaultChangePaths(changedPaths);

        // A changed shard's cached tree no longer matches its text, so the
        // next open misses it and drops it.
        if (unsuppressedPaths.length > 0) {
          await closeOpenFileIfRemoved(unsuppressedPaths);
        }
      }

      // Checked even for the app's own saves: those leave the text as it was
      // saved, but a change right after one would otherwise be missed.
      // No paths means the OS dropped events, so anything may have changed.
      if (
        changedPaths.length === 0 ||
        changedPaths.some((filePath) => isOpenShard(filePath))
      ) {
        void reloadOpenShardIfChanged();
      }
      if (
        changedPaths.length === 0 ||
        changedPaths.some((filePath) => isOpenDrawing(filePath))
      ) {
        void reloadOpenDrawingIfChanged();
      }

      try {
        const tree = await scanVault(path);
        if (!cancelled) setFileTree(tree);
      } catch (err) {
        console.error("[Netherstone] Rescan after file change failed:", err);
      }
    }).then((unlisten) => {
      // If the effect was already cleaned up before listen() resolved,
      // immediately call unlisten so we don't leak the listener.
      if (cancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
      stopVaultWatcher().catch(console.error);
    };
  }, [currentVaultPath, setFileTree]);
}

function isOpenDrawing(filePath: string) {
  const openPath = useUIStore.getState().activeDrawingPath;
  return !!openPath && isSamePath(openPath, filePath);
}

function isOpenShard(filePath: string) {
  const openPath = useEditorStore.getState().currentFilePath;
  return !!openPath && isSamePath(openPath, filePath);
}

async function closeOpenFileIfRemoved(changedPaths: string[]) {
  const openPath = useEditorStore.getState().currentFilePath;
  if (!openPath) return;
  if (!changedPaths.some((path) => isPathWithin(openPath, path))) return;

  try {
    if (await fileExists(openPath)) return;
  } catch (err) {
    console.error("[Netherstone] Couldn't check the open shard:", err);
    return;
  }

  // Another shard may have been opened while the check ran.
  const editor = useEditorStore.getState();
  if (editor.currentFilePath === openPath) editor.closeFile();
}
