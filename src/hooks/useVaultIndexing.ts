import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { isAttachmentOnlyChange } from "@/lib/gallery";
import { partitionSuppressedVaultChangePaths } from "@/lib/vault-change-suppression";
import { indexVault } from "@/lib/refresh-vault";
import { getBrokenLinks, missingFileRows } from "@/lib/data";
import { useAttachmentReportStore, useUIStore, useVaultStore } from "@/store";

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

/** Indexes the vault when it opens, and again when its files change. */
export function useVaultIndexing() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);

  // Each opened vault is indexed, also when it's opened again: indexing
  // another vault drops this one's rows.
  useEffect(() => {
    if (!currentVaultPath) return;
    void runIndexing(currentVaultPath).then(() =>
      checkVaultHealth(currentVaultPath),
    );
  }, [currentVaultPath]);

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
        void runIndexing(currentVaultPath);
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
}

async function runIndexing(vaultPath: string) {
  try {
    await indexVault(vaultPath);
  } catch (error) {
    console.error("Indexing failed:", error);
  }
}
