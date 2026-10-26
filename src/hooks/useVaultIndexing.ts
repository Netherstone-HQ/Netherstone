import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { isAttachmentOnlyChange } from "@/lib/gallery";
import { partitionSuppressedVaultChangePaths } from "@/lib/vault-change-suppression";
import { indexVault } from "@/lib/refresh-vault";
import { getBrokenLinks, missingFileRows } from "@/lib/data";
import { useAttachmentReportStore, useUIStore, useVaultStore } from "@/store";

const initialIndexedVaultPaths = new Set<string>();

type VaultChangedPayload = {
  paths?: string[];
};

/**
 * Reconciles the vault's attachments once it is opened, and points out links
 * to shards or files that are no longer in the vault.
 */
async function checkVaultHealth(vaultPath: string) {
  const [report, brokenLinks] = await Promise.all([
    useAttachmentReportStore.getState().check(vaultPath),
    getBrokenLinks().catch(() => []),
  ]);
  const count =
    brokenLinks.length + missingFileRows(report?.missing ?? []).length;
  if (count === 0) return;

  toast.warning(count === 1 ? "1 broken link" : `${count} broken links`, {
    duration: 10_000,
    action: {
      label: "Review",
      onClick: () => useUIStore.getState().openMode("data"),
    },
  });
}

function getChangedVaultPaths(payload: VaultChangedPayload | null | undefined) {
  return Array.isArray(payload?.paths)
    ? payload.paths.filter(
        (filePath): filePath is string =>
          typeof filePath === "string" && filePath.trim().length > 0,
      )
    : [];
}

/**
 * Hook to trigger vault indexing when a vault is opened or files change.
 *
 * Runs the indexing process in the background and tracks its status.
 * Also listens for vault:changed events to re-index when files are modified.
 */
export function useVaultIndexing() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [reindexTick, setReindexTick] = useState(0);

  const runIndexing = useCallback(async (vaultPath: string) => {
    setIsIndexing(true);
    setIndexingError(null);

    try {
      const result = await indexVault(vaultPath);
      console.log("Indexing complete:", result);
    } catch (error) {
      console.error("Indexing failed:", error);
      setIndexingError(error as string);
    } finally {
      setIsIndexing(false);
    }
  }, []);

  // Index when vault is first opened.
  // Guard against React Strict Mode double-invoking mount effects in development.
  useEffect(() => {
    if (!currentVaultPath) return;
    if (initialIndexedVaultPaths.has(currentVaultPath)) return;

    initialIndexedVaultPaths.add(currentVaultPath);
    void runIndexing(currentVaultPath).then(() =>
      checkVaultHealth(currentVaultPath),
    );
  }, [currentVaultPath, runIndexing]);

  // Re-index when files change, but coalesce bursts of events.
  useEffect(() => {
    if (!currentVaultPath) return;

    let unlistenFn: (() => void) | undefined;
    let debounceTimer: number | null = null;

    listen<VaultChangedPayload>("vault:changed", (event) => {
      const changedPaths = getChangedVaultPaths(event.payload);
      // Attachment files aren't indexed.
      if (isAttachmentOnlyChange(changedPaths, currentVaultPath)) return;

      // Changes the app made itself are skipped.
      if (
        changedPaths.length > 0 &&
        partitionSuppressedVaultChangePaths(changedPaths).unsuppressedPaths
          .length === 0
      ) {
        return;
      }

      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }

      // Saving and watcher updates can fire rapidly while typing.
      // Delay re-index so tag/headings updates don't interrupt editing.
      debounceTimer = window.setTimeout(() => {
        setReindexTick((v) => v + 1);
      }, 3000);
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      unlistenFn?.();
    };
  }, [currentVaultPath]);

  useEffect(() => {
    if (!currentVaultPath || reindexTick === 0) return;
    runIndexing(currentVaultPath);
  }, [currentVaultPath, reindexTick, runIndexing]);

  return {
    isIndexing,
    indexingError,
    reindex: () => currentVaultPath && runIndexing(currentVaultPath),
  };
}
