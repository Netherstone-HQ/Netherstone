import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ATTACHMENTS_SECTION_ID } from "@/components/settings/AttachmentsSection";
import { openMarkdownFile, upsertAstCache } from "@/lib/editor-ast-cache";
import { isMarkdownPath } from "@/lib/drawing-files";
import {
  beginAstWarmAttempt,
  cancelAstWarmAttempt,
  finishAstWarmAttempt,
  getAstWarmAttemptSignal,
  invalidateAstWarmPaths,
  isAstWarmAttemptCurrent,
  isAstWarmPathInFlight,
  isAstWarmPathWarmed,
} from "@/lib/editor-ast-warm-state";
import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { partitionSuppressedVaultChangePaths } from "@/lib/vault-change-suppression";
import {
  useAttachmentReportStore,
  useEditorStore,
  useUIStore,
  useVaultStore,
  type FileTreeNode,
} from "@/store";

const initialIndexedVaultPaths = new Set<string>();
const AST_WARMUP_DELAY_MS = 1500;

type VaultChangedPayload = {
  paths?: string[];
};

function flattenFilePaths(nodes: FileTreeNode[]): string[] {
  const filePaths: string[] = [];

  const walk = (entries: FileTreeNode[]) => {
    for (const entry of entries) {
      if (entry.kind === "file") {
        if (isMarkdownPath(entry.path)) filePaths.push(entry.path);
        continue;
      }

      if (entry.children?.length) {
        walk(entry.children);
      }
    }
  };

  walk(nodes);
  return filePaths.sort();
}

/**
 * Reconciles the vault's attachments once it is opened, and points out links
 * to files that are no longer in the vault.
 */
async function checkAttachments(vaultPath: string) {
  const report = await useAttachmentReportStore.getState().check(vaultPath);
  const missingCount = report?.missing.length ?? 0;
  if (missingCount === 0) return;

  toast.warning(
    missingCount === 1
      ? "1 attachment is missing"
      : `${missingCount} attachments are missing`,
    {
      description: "Some shards link to files that aren't in this vault.",
      duration: 10_000,
      action: {
        label: "Review",
        onClick: () => {
          useUIStore.getState().openSettings("files");
          // Wait for the settings view to mount.
          window.setTimeout(() => {
            document
              .getElementById(ATTACHMENTS_SECTION_ID)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        },
      },
    },
  );
}

function buildFilePathsKey(filePaths: readonly string[]) {
  return filePaths.join("\u0000");
}

function getChangedVaultPaths(payload: VaultChangedPayload | null | undefined) {
  return Array.isArray(payload?.paths)
    ? payload.paths.filter(
        (filePath): filePath is string =>
          typeof filePath === "string" && filePath.trim().length > 0,
      )
    : [];
}

function shouldAbortAstWarmAttempt(
  filePath: string,
  attemptToken: number,
  currentOpenFilePath: string | null,
  cancelled: boolean,
) {
  return (
    cancelled ||
    filePath === currentOpenFilePath ||
    !isAstWarmAttemptCurrent(filePath, attemptToken)
  );
}

/**
 * Hook to trigger vault indexing when a vault is opened or files change.
 *
 * Runs the indexing process in the background and tracks its status.
 * Also listens for vault:changed events to re-index when files are modified.
 */
export function useVaultIndexing() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const currentFilePathRef = useRef(currentFilePath);
  const filePaths = useMemo(() => flattenFilePaths(fileTree), [fileTree]);
  const filePathsKey = useMemo(() => buildFilePathsKey(filePaths), [filePaths]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexingError, setIndexingError] = useState<string | null>(null);
  const [reindexTick, setReindexTick] = useState(0);

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  const runIndexing = useCallback(async (vaultPath: string) => {
    setIsIndexing(true);
    setIndexingError(null);

    try {
      const result = await invoke<string>("index_vault", {
        vaultPath,
      });
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
      checkAttachments(currentVaultPath),
    );
  }, [currentVaultPath, runIndexing]);

  // Re-index when files change, but coalesce bursts of events.
  useEffect(() => {
    if (!currentVaultPath) return;

    let unlistenFn: (() => void) | undefined;
    let debounceTimer: number | null = null;

    listen<VaultChangedPayload>("vault:changed", (event) => {
      const changedPaths = getChangedVaultPaths(event.payload);

      if (changedPaths.length > 0) {
        const { suppressedPaths, unsuppressedPaths } =
          partitionSuppressedVaultChangePaths(changedPaths);

        if (suppressedPaths.length > 0) {
          console.info(
            "[Netherstone] Background AST cache warm state unchanged for suppressed app-initiated watcher event(s):",
            suppressedPaths,
          );
        }

        if (unsuppressedPaths.length === 0) {
          return;
        }

        const invalidatedPaths = invalidateAstWarmPaths(unsuppressedPaths);

        if (invalidatedPaths.length > 0) {
          console.info(
            "[Netherstone] Background AST cache warm state invalidated for changed file(s):",
            invalidatedPaths,
          );
        }
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

  useEffect(() => {
    if (!currentVaultPath || isIndexing || filePaths.length === 0) return;

    let cancelled = false;

    const warmAstCache = async () => {
      console.info(
        `[Netherstone] Starting background AST cache warming for ${filePaths.length} file(s) in ${currentVaultPath}`,
      );

      for (const filePath of filePaths) {
        if (cancelled) return;

        if (filePath === currentFilePathRef.current) {
          console.info(
            "[Netherstone] Background AST cache warm skipped for open file:",
            filePath,
          );
          continue;
        }

        if (isAstWarmPathWarmed(filePath)) {
          console.info(
            "[Netherstone] Background AST cache warm skipped for already warmed file:",
            filePath,
          );
          continue;
        }

        if (isAstWarmPathInFlight(filePath)) {
          console.info(
            "[Netherstone] Background AST cache warm skipped for in-flight file:",
            filePath,
          );
          continue;
        }

        const attemptToken = beginAstWarmAttempt(filePath);
        if (attemptToken === null) {
          continue;
        }

        try {
          const latestOpenFilePath = useEditorStore.getState().currentFilePath;

          if (
            shouldAbortAstWarmAttempt(
              filePath,
              attemptToken,
              latestOpenFilePath,
              cancelled,
            )
          ) {
            cancelAstWarmAttempt(filePath, attemptToken);
            continue;
          }

          const openResult = await openMarkdownFile(filePath);

          if (
            shouldAbortAstWarmAttempt(
              filePath,
              attemptToken,
              useEditorStore.getState().currentFilePath,
              cancelled,
            )
          ) {
            cancelAstWarmAttempt(filePath, attemptToken);
            continue;
          }

          if (openResult.cacheHit) {
            finishAstWarmAttempt(filePath, attemptToken, { warmed: true });
            console.info(
              "[Netherstone] Background AST cache warm skipped for cache-hit file:",
              filePath,
            );
            continue;
          }

          const deserializeSignal = getAstWarmAttemptSignal(
            filePath,
            attemptToken,
          );

          if (!deserializeSignal) {
            cancelAstWarmAttempt(filePath, attemptToken);
            continue;
          }

          const plateValue = await deserializeMarkdownInWorker(
            openResult.markdown,
            {
              filePath,
              signal: deserializeSignal,
            },
          );

          if (
            shouldAbortAstWarmAttempt(
              filePath,
              attemptToken,
              useEditorStore.getState().currentFilePath,
              cancelled,
            )
          ) {
            cancelAstWarmAttempt(filePath, attemptToken);
            continue;
          }

          await upsertAstCache({
            filePath,
            markdown: openResult.markdown,
            plateValue,
          });

          if (!finishAstWarmAttempt(filePath, attemptToken, { warmed: true })) {
            continue;
          }

          console.info(
            "[Netherstone] Background AST cache warm complete:",
            filePath,
          );

          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 0);
          });
        } catch (error) {
          if (cancelled) return;

          if (error instanceof DOMException && error.name === "AbortError") {
            console.info(
              "[Netherstone] Background AST cache warm aborted:",
              filePath,
            );
            continue;
          }

          console.error(
            "[Netherstone] Background AST cache warm failed:",
            filePath,
            error,
          );
        } finally {
          cancelAstWarmAttempt(filePath, attemptToken);
        }
      }

      if (!cancelled) {
        console.info(
          "[Netherstone] Background AST cache warming complete:",
          currentVaultPath,
        );
      }
    };

    const timer = window.setTimeout(() => {
      void warmAstCache();
    }, AST_WARMUP_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentVaultPath, filePathsKey, isIndexing]);

  return {
    isIndexing,
    indexingError,
    reindex: () => currentVaultPath && runIndexing(currentVaultPath),
  };
}
