import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { scanVault, startVaultWatcher, stopVaultWatcher } from "@/lib/commands";
import { deleteAstCache } from "@/lib/editor-ast-cache";
import { invalidateAstWarmPaths } from "@/lib/editor-ast-warm-state";
import { partitionSuppressedVaultChangePaths } from "@/lib/vault-change-suppression";
import { useVaultStore } from "@/store";

type VaultChangedPayload = {
  paths?: string[];
};

/**
 * Starts a native file watcher on the current vault whenever it changes.
 * When the Rust backend emits `vault:changed` (debounced 500ms), the vault
 * is rescanned and the file tree is updated.
 *
 * Cleans up the watcher and the event listener when the vault changes or
 * the component unmounts.
 */
export function useVaultWatcher() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const setFileTree = useVaultStore((s) => s.setFileTree);

  useEffect(() => {
    if (!currentVaultPath) return;

    // Capture path so the closure always refers to the vault that was active
    // when this effect ran, not whatever currentVaultPath is later.
    const path = currentVaultPath;

    // Tracks whether the effect has been cleaned up. Guards against state
    // updates landing after the vault has been switched or unmounted.
    let cancelled = false;

    // Holds the unlisten function once the async listen() resolves.
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

      if (changedPaths.length > 0) {
        const { suppressedPaths, unsuppressedPaths } =
          partitionSuppressedVaultChangePaths(changedPaths);

        if (suppressedPaths.length > 0) {
          console.info(
            "[Netherstone] Ignoring suppressed app-initiated watcher event(s):",
            suppressedPaths,
          );
        }

        if (unsuppressedPaths.length > 0) {
          invalidateAstWarmPaths(unsuppressedPaths);

          await Promise.allSettled(
            unsuppressedPaths.map(async (filePath) => {
              try {
                await deleteAstCache(filePath);
              } catch (err) {
                console.error(
                  "[Netherstone] AST cache invalidation after file change failed:",
                  filePath,
                  err,
                );
              }
            }),
          );
        }
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
