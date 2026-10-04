import { useLayoutEffect } from "react";
import { useSettingsStore, useUIStore, useVaultStore } from "@/store";
import { scanVault } from "@/lib/commands";
import { isDrawingPath, isPathWithin } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";

const initializedVaultPaths = new Set<string>();

/**
 * Runs once on app mount. If a vault path was persisted from a previous
 * session, rescans it to rebuild the file tree.
 *
 * If the vault folder no longer exists (deleted, moved, unmounted drive),
 * the persisted path is cleared so the app starts fresh. Meanwhile the last
 * shard is reopened, unless that's turned off in Settings.
 *
 * A layout effect, so the editor knows that shard is on its way before the
 * first paint and never shows "No shard open" in between.
 */
export function useVaultInit() {
  useLayoutEffect(() => {
    // Read directly from the store instead of the closure to keep the
    // dependency array empty — this is intentionally a mount-only effect.
    const { currentVaultPath, setFileTree, setVaultLoading, clearVault } =
      useVaultStore.getState();

    if (!currentVaultPath) return;

    if (initializedVaultPaths.has(currentVaultPath)) {
      return;
    }

    initializedVaultPaths.add(currentVaultPath);
    setVaultLoading(true);

    // Opening a shard doesn't need the tree, so don't wait for the scan.
    void reopenLastShard(currentVaultPath);

    scanVault(currentVaultPath)
      .then((tree) => {
        setFileTree(tree);
      })
      .catch(() => {
        initializedVaultPaths.delete(currentVaultPath);
        console.warn(
          `[Netherstone] Persisted vault "${currentVaultPath}" is no longer accessible. Clearing.`,
        );
        clearVault();
      })
      .finally(() => setVaultLoading(false));
  }, []);
}

async function reopenLastShard(vaultPath: string) {
  if (!useSettingsStore.getState().reopenLastShard) return;

  const last = useUIStore
    .getState()
    .recentFiles.find(
      (file) => !isDrawingPath(file.path) && isPathWithin(file.path, vaultPath),
    );
  if (!last) return;

  try {
    await openEditorFile(last.path);
  } catch {
    // Moved or deleted since; start on the empty state instead.
  }
}
