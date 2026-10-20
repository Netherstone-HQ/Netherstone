import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileQuestionIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import {
  CLEANUP_GRACE_DAYS,
  cleanUpAttachments,
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
import { useAttachmentReportStore, useVaultStore } from "@/store";
import {
  formatBytes,
  getAssetLabel,
  plural,
} from "@/components/settings/attachment-format";
import { ExternalFilesRow } from "@/components/settings/AttachmentMigrationRows";

export const ATTACHMENTS_SECTION_ID = "settings-attachments";

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
 * period to the trash after previewing them.
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
          `Moved ${plural(result.removed.length, "file")} to trash`,
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
    <div className="flex items-start gap-3 px-4 py-3 text-ui">
      <FileQuestionIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div>
          {unused.length === 0
            ? "No unused files"
            : `${plural(unused.length, "unused file")} · ${formatBytes(sumBytes(unused))}`}
        </div>
        {unused.length > 0 ? (
          <p className="text-muted-foreground text-ui-sm">
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
              Move {plural(ready.length, "unused file")} to trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              No shard has linked to these for {CLEANUP_GRACE_DAYS} days. This
              frees {formatBytes(sumBytes(ready))}, and you can restore them
              from the trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-ui-sm">
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
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The open vault's attachments: files no shard uses, and files linked from
 * outside the attachment folder. Missing files are under Broken links on the
 * Overview page.
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
    <SettingsGroup
      id={ATTACHMENTS_SECTION_ID}
      title="Attachments in this vault"
    >
      <SettingRow
        label={
          currentReport
            ? `${plural(currentReport.fileCount, "file")} · ${formatBytes(currentReport.totalBytes)}`
            : "Files copied into this vault"
        }
      >
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
      </SettingRow>

      {isCurrent && error && !isChecking ? (
        <p className="px-4 py-3 text-destructive text-ui">
          Couldn't check attachments: {error}
        </p>
      ) : null}

      {currentReport ? (
        <>
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
        </>
      ) : isChecking ? (
        <p className="px-4 py-3 text-muted-foreground text-ui">
          Checking attachments
        </p>
      ) : null}
    </SettingsGroup>
  );
}
