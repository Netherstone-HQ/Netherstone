import { useState } from "react";
import { toast } from "sonner";
import { CircleCheckIcon, Loader2Icon } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  getAssetLabel,
  getFileName,
} from "@/components/settings/attachment-format";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  CLEANUP_GRACE_DAYS,
  cleanUpAttachments,
  type AttachmentReport,
  type UnusedAttachment,
} from "@/lib/commands";
import { missingFileRows, type BrokenLink } from "@/lib/data";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { replaceAttachmentPath, rewriteShards } from "@/lib/shard-rewrite";
import { cn } from "@/lib/utils";
import { useAttachmentReportStore } from "@/store";
import {
  Card,
  GROUP_LABEL_CLASS,
  LINK_ROW_CLASS,
  LIST_ROW_CLASS,
  openShardAt,
  plural,
} from "./rows";

const DAY_SECONDS = 24 * 60 * 60;
/** Fits a button in a row without making it taller. */
const ROW_BUTTON_CLASS = "h-7 shrink-0 text-ui-sm";

function shardName(shardPath: string) {
  return getVaultFileDisplayName(getFileName(shardPath));
}

/**
 * A file a shard embeds that isn't in the vault. Relink points every shard
 * using it at the same file found under another name.
 */
function MissingFileRow({
  name,
  assetPath,
  foundAssetPath,
  shardPath,
  shardPaths,
  vaultPath,
}: {
  name: string;
  assetPath: string;
  foundAssetPath: string | null;
  shardPath: string;
  /** Every shard embedding the file. */
  shardPaths: string[];
  vaultPath: string;
}) {
  const check = useAttachmentReportStore((s) => s.check);
  const [isRelinking, setIsRelinking] = useState(false);

  const relink = async (found: string) => {
    setIsRelinking(true);
    try {
      await rewriteShards(shardPaths, (markdown) =>
        replaceAttachmentPath(markdown, assetPath, found),
      );
      toast.success(`Relinked to ${getFileName(found)}`);
      await check(vaultPath);
    } catch (error) {
      console.error("[Netherstone] Relink failed:", error);
      toast.error("Couldn't relink the file");
    } finally {
      setIsRelinking(false);
    }
  };

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        className={LINK_ROW_CLASS}
        title={assetPath}
        onClick={() => void openShardAt({ path: shardPath, assetPath })}
      >
        <span className="min-w-0 truncate">{name}</span>
        <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
          in {shardName(shardPath)}
        </span>
      </button>
      {foundAssetPath ? (
        <Button
          variant="outline"
          size="sm"
          className={ROW_BUTTON_CLASS}
          disabled={isRelinking}
          title={`Use ${foundAssetPath}`}
          onClick={() => void relink(foundAssetPath)}
        >
          Relink
        </Button>
      ) : null}
    </li>
  );
}

/** Mirrors the backend: unused past the grace period, or a leftover .tmp. */
function isReadyForCleanup(file: UnusedAttachment, nowSeconds: number) {
  return (
    file.assetPath.endsWith(".tmp") ||
    (file.unusedSince !== null &&
      nowSeconds - file.unusedSince >= CLEANUP_GRACE_DAYS * DAY_SECONDS)
  );
}

/** Days until the first waiting file can be cleaned up. */
function daysUntilCleanup(waiting: UnusedAttachment[], nowSeconds: number) {
  const soonest = Math.min(
    ...waiting.map((file) =>
      file.unusedSince === null
        ? CLEANUP_GRACE_DAYS
        : CLEANUP_GRACE_DAYS - (nowSeconds - file.unusedSince) / DAY_SECONDS,
    ),
  );
  return Math.max(1, Math.ceil(soonest));
}

function sumBytes(files: UnusedAttachment[]) {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

/**
 * Files no shard uses, with their sizes. Clean up moves the ones unused for
 * the grace period to the trash after previewing them; newer ones wait.
 */
function UnusedFiles({
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
  const waiting = unused.filter((file) => !ready.includes(file));

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
          `Moved ${plural(result.removed.length, "file", "files")} to trash`,
          {
            description:
              result.kept.length > 0
                ? `Freed ${formatBytes(result.freedBytes)}. Kept ${plural(result.kept.length, "file", "files")} that ${result.kept.length === 1 ? "is" : "are"} in use again.`
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
    <div>
      <div className={cn(GROUP_LABEL_CLASS, "pr-1")}>
        <span>Unused files</span>
        <span className="tabular-nums">{unused.length.toLocaleString()}</span>
        {ready.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className={cn(ROW_BUTTON_CLASS, "ml-auto text-foreground")}
            onClick={() => setIsConfirmOpen(true)}
          >
            Clean up
          </Button>
        ) : (
          <span className="ml-auto pr-1.5">
            Clean up in{" "}
            {plural(daysUntilCleanup(waiting, nowSeconds), "day", "days")}
          </span>
        )}
      </div>
      <ul aria-label="Unused files">
        {unused.map((file) => (
          <li
            key={file.assetPath}
            className={LIST_ROW_CLASS}
            title={file.assetPath}
          >
            <span className="min-w-0 truncate">
              {getAssetLabel(file.assetPath)}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground text-ui-sm tabular-nums">
              {formatBytes(file.sizeBytes)}
            </span>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={isConfirmOpen}
        onOpenChange={(open) => {
          if (!isCleaning) setIsConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {plural(ready.length, "unused file", "unused files")} to
              trash?
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

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className={GROUP_LABEL_CLASS}>
        <span>{label}</span>
        <span className="tabular-nums">{count.toLocaleString()}</span>
      </div>
      <ul aria-label={label}>{children}</ul>
    </div>
  );
}

/**
 * What needs fixing in the vault: @ links to shards that don't exist, files
 * shards embed that are gone, and files no shard uses, each in its group.
 */
export function Health({
  links,
  report,
  vaultPath,
  className,
}: {
  links: BrokenLink[];
  report: AttachmentReport | null;
  vaultPath: string;
  className?: string;
}) {
  const missingRows = missingFileRows(report?.missing ?? []);
  const unused = report?.unused ?? [];

  return (
    <Card title="Health" isList className={className}>
      {links.length === 0 && missingRows.length === 0 && unused.length === 0 ? (
        <div className="flex items-center gap-2.5 px-2.5 py-1 text-ui">
          <CircleCheckIcon className="size-5 shrink-0 text-chart-3" />
          Nothing needs attention.
        </div>
      ) : null}
      {links.length > 0 ? (
        <Group label="Broken links" count={links.length}>
          {links.map((link, i) => (
            <li key={`${link.path}-${i}`}>
              <button
                type="button"
                className={LINK_ROW_CLASS}
                onClick={() =>
                  void openShardAt({ path: link.path, text: link.text })
                }
              >
                <span className="min-w-0 truncate">@{link.text}</span>
                <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
                  in {getVaultFileDisplayName(link.name)}
                </span>
              </button>
            </li>
          ))}
        </Group>
      ) : null}
      {missingRows.length > 0 ? (
        <Group label="Missing files" count={missingRows.length}>
          {missingRows.map(({ file, name, shardPath }) => (
            <MissingFileRow
              key={`${file.assetPath}-${shardPath}`}
              name={name}
              assetPath={file.assetPath}
              foundAssetPath={file.foundAssetPath}
              shardPath={shardPath}
              shardPaths={file.shardPaths}
              vaultPath={vaultPath}
            />
          ))}
        </Group>
      ) : null}
      {unused.length > 0 ? (
        <UnusedFiles unused={unused} vaultPath={vaultPath} />
      ) : null}
    </Card>
  );
}
