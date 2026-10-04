import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  FileQuestionIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { relinkAttachment } from "@/lib/shard-rewrite";
import {
  CLEANUP_GRACE_DAYS,
  cleanUpAttachments,
  type MissingAttachment,
  type UnusedAttachment,
} from "@/lib/commands";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAttachmentReportStore, useUIStore, useVaultStore } from "@/store";
import {
  formatBytes,
  getAssetLabel,
  getFileName,
  plural,
} from "@/components/settings/attachment-format";
import {
  ExternalFilesRow,
  TidyRow,
} from "@/components/settings/AttachmentMigrationRows";

export const ATTACHMENTS_SECTION_ID = "settings-attachments";

function openShard(filePath: string) {
  const ui = useUIStore.getState();
  ui.setActiveNavItem(null);
  ui.setAppMode("notes");
  void openEditorFile(filePath);
}

/** Points a missing file's links at the same file found under a new name. */
function RelinkButton({
  file,
  vaultPath,
}: {
  file: MissingAttachment & { foundAssetPath: string };
  vaultPath: string;
}) {
  const check = useAttachmentReportStore((s) => s.check);
  const [isRelinking, setIsRelinking] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={isRelinking}
      title={`Point links to ${file.foundAssetPath}`}
      onClick={async () => {
        setIsRelinking(true);
        try {
          await relinkAttachment(
            file.shardPaths,
            file.assetPath,
            file.foundAssetPath,
          );
          toast.success("Relinked attachment", {
            description: getFileName(file.foundAssetPath),
          });
          await check(vaultPath);
        } catch (error) {
          console.error("[Netherstone] Relink failed:", error);
          toast.error("Couldn't relink attachment", {
            description: error instanceof Error ? error.message : String(error),
          });
        } finally {
          setIsRelinking(false);
        }
      }}
    >
      Use {getFileName(file.foundAssetPath)}
    </Button>
  );
}

const GRACE_SECONDS = CLEANUP_GRACE_DAYS * 24 * 60 * 60;

/** Mirrors the backend: unused past the grace period, or a leftover .tmp. */
function isReadyForCleanup(file: UnusedAttachment, nowSeconds: number) {
  return (
    file.assetPath.endsWith(".tmp") ||
    (file.unusedSince !== null &&
      nowSeconds - file.unusedSince >= GRACE_SECONDS)
  );
}

function sumBytes(files: UnusedAttachment[]) {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

/**
 * Unused files, and a cleanup that moves the ones unused for the grace
 * period to the Trash after previewing them.
 */
function UnusedFilesRow({
  unused,
  vaultPath,
}: {
  unused: UnusedAttachment[];
  vaultPath: string;
}) {
  const check = useAttachmentReportStore((s) => s.check);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  const nowSeconds = Date.now() / 1000;
  const ready = unused.filter((file) => isReadyForCleanup(file, nowSeconds));
  const waitingCount = unused.length - ready.length;

  const cleanUp = async () => {
    setIsCleaning(true);
    try {
      // Links only in the editor would otherwise not count as uses.
      await flushPendingAutosave();
      const result = await cleanUpAttachments(
        vaultPath,
        ready.map((file) => file.assetPath),
      );

      if (result.removed.length > 0) {
        toast.success(
          `Moved ${plural(result.removed.length, "file")} to Trash`,
          {
            description:
              result.kept.length > 0
                ? `Freed ${formatBytes(result.freedBytes)}. Kept ${plural(result.kept.length, "file")} that ${result.kept.length === 1 ? "is" : "are"} in use again.`
                : `Freed ${formatBytes(result.freedBytes)}.`,
          },
        );
      } else {
        toast.info("Nothing to clean up", {
          description: "These files are in use again.",
        });
      }
    } catch (error) {
      console.error("[Netherstone] Attachment cleanup failed:", error);
      toast.error("Couldn't clean up attachments", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsCleaning(false);
      setIsConfirmOpen(false);
      void check(vaultPath);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm">
      <FileQuestionIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div>
          {unused.length === 0
            ? "No unused files"
            : `${plural(unused.length, "unused file")} · ${formatBytes(sumBytes(unused))}`}
        </div>
        {unused.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {ready.length === 0
              ? `No shard links to these. They can be cleaned up once unused for ${CLEANUP_GRACE_DAYS} days.`
              : waitingCount > 0
                ? `${plural(ready.length, "file")} unused for ${CLEANUP_GRACE_DAYS}+ days. ${waitingCount} more ${waitingCount === 1 ? "is" : "are"} kept until then.`
                : `Unused for ${CLEANUP_GRACE_DAYS}+ days.`}
          </p>
        ) : null}
      </div>
      {ready.length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsConfirmOpen(true)}
        >
          Clean up
        </Button>
      ) : null}

      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={(open) => {
          if (!isCleaning) setIsConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {plural(ready.length, "unused file")} to Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              No shard has linked to these for {CLEANUP_GRACE_DAYS} days. This
              frees {formatBytes(sumBytes(ready))}, and you can restore them
              from the Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-xs">
            {ready.map((file) => (
              <li
                key={file.assetPath}
                className="flex items-baseline gap-3"
                title={file.assetPath}
              >
                <span className="min-w-0 flex-1 truncate">
                  {getAssetLabel(file.assetPath)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCleaning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isCleaning}
              onClick={(event) => {
                event.preventDefault();
                void cleanUp();
              }}
            >
              {isCleaning ? <Loader2Icon className="animate-spin" /> : null}
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Health of the open vault's attachments: files that shards link to but are
 * gone, and files no shard uses.
 */
export function AttachmentsSection() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const reportVaultPath = useAttachmentReportStore((s) => s.vaultPath);
  const report = useAttachmentReportStore((s) => s.report);
  const isChecking = useAttachmentReportStore((s) => s.isChecking);
  const error = useAttachmentReportStore((s) => s.error);
  const check = useAttachmentReportStore((s) => s.check);

  const isCurrent = !!currentVaultPath && reportVaultPath === currentVaultPath;

  useEffect(() => {
    if (currentVaultPath && reportVaultPath !== currentVaultPath) {
      void check(currentVaultPath);
    }
  }, [check, currentVaultPath, reportVaultPath]);

  if (!currentVaultPath) return null;

  const currentReport = isCurrent ? report : null;

  return (
    <section
      id={ATTACHMENTS_SECTION_ID}
      className="scroll-mt-8 rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="font-medium text-sm">Attachments in this vault</h3>
          <p className="text-muted-foreground text-xs">
            {currentReport
              ? `${plural(currentReport.fileCount, "file")} · ${formatBytes(currentReport.totalBytes)} in this vault`
              : "Files copied into this vault."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isChecking}
          onClick={() => void check(currentVaultPath)}
        >
          {isChecking ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          Check again
        </Button>
      </div>

      {isCurrent && error && !isChecking ? (
        <p className="text-destructive text-sm">
          Couldn't check attachments: {error}
        </p>
      ) : null}

      {currentReport ? (
        <div className="divide-y rounded-lg border bg-background">
          {currentReport.missing.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              <CheckCircle2Icon className="size-4 shrink-0 text-primary" />
              Every linked file is in the vault
            </div>
          ) : (
            <div className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-3 text-sm">
                <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
                <span className="font-medium">
                  {plural(currentReport.missing.length, "missing file")}
                </span>
              </div>
              <ul className="space-y-1 pl-7 text-sm">
                {currentReport.missing.map((file) => (
                  <li
                    key={file.assetPath}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                  >
                    <span
                      className="max-w-64 truncate text-muted-foreground"
                      title={file.assetPath}
                    >
                      {file.originalName ?? getAssetLabel(file.assetPath)}
                    </span>
                    <span className="text-muted-foreground text-xs">in</span>
                    {file.shardPaths.map((shardPath, index) => (
                      <button
                        key={shardPath}
                        type="button"
                        title={shardPath}
                        onClick={() => openShard(shardPath)}
                        className="max-w-48 truncate text-left text-foreground underline-offset-2 hover:underline"
                      >
                        {getVaultFileDisplayName(getFileName(shardPath))}
                        {index < file.shardPaths.length - 1 ? "," : ""}
                      </button>
                    ))}
                    {file.foundAssetPath ? (
                      <span className="ml-auto">
                        <RelinkButton
                          file={{
                            ...file,
                            foundAssetPath: file.foundAssetPath,
                          }}
                          vaultPath={currentVaultPath}
                        />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <UnusedFilesRow
            unused={currentReport.unused}
            vaultPath={currentVaultPath}
          />
          {currentReport.externalFiles.length > 0 ? (
            <ExternalFilesRow
              files={currentReport.externalFiles}
              vaultPath={currentVaultPath}
            />
          ) : null}
          {currentReport.tidyRenames.length > 0 ? (
            <TidyRow
              renames={currentReport.tidyRenames}
              vaultPath={currentVaultPath}
            />
          ) : null}
        </div>
      ) : isChecking ? (
        <p className="text-muted-foreground text-sm">Checking attachments</p>
      ) : null}
    </section>
  );
}
