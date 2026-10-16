"use client";

import * as React from "react";

import {
  EllipsisIcon,
  FileIcon,
  FileWarningIcon,
  FolderOpenIcon,
  LinkIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import {
  type AttachmentSyncStatusLike,
  describeUnsyncedFiles,
} from "@/lib/attachment-sync-status";
import {
  describeMissingAttachment,
  type MissingAttachmentInfo,
} from "@/lib/commands";
import { toVaultRelativePath } from "@/lib/drawing-files";
import { REVEAL_LABEL } from "@/lib/platform";
import { formatBytes } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store/vault";

export type MediaRowMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

// Plate selects the node on mousedown; buttons in the row act on their own.
function stopPlate(event: React.SyntheticEvent) {
  event.stopPropagation();
}

/**
 * A file in a shard on one line: its icon, name and details. Clicking the
 * row opens the file; its other actions show on hover.
 */
export function MediaFileRow({
  icon,
  name,
  nameHint,
  details,
  warning = false,
  onOpen,
  action,
  onReveal,
  menu = [],
  className,
}: {
  /** A warning row defaults to the warning file icon. */
  icon?: LucideIcon;
  name: string;
  /** Shown when hovering the name, such as where the file is. */
  nameHint?: string | null;
  details?: React.ReactNode;
  /** The file can't be used as it is: the row is marked, its actions always show. */
  warning?: boolean;
  onOpen?: () => void;
  action?: { label: string; onSelect: () => void };
  onReveal?: () => void;
  menu?: MediaRowMenuItem[];
  className?: string;
}) {
  const Icon = icon ?? (warning ? FileWarningIcon : FileIcon);
  const nameNode = (
    <span className="min-w-0 truncate font-medium">{name}</span>
  );

  return (
    <div
      className={cn(
        "group/file flex h-11 w-full items-center gap-2.5 rounded-lg border bg-card pr-1.5 pl-3 text-ui transition-colors",
        warning
          ? "border-amber-500/30 bg-amber-500/5"
          : onOpen && "cursor-pointer hover:border-foreground/20",
        className,
      )}
      contentEditable={false}
      data-plate-prevent-deselect
      onClick={onOpen}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          warning
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      />
      {nameHint ? <Hint label={nameHint}>{nameNode}</Hint> : nameNode}
      {details ? (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-ui-sm">
          {details}
        </span>
      ) : null}

      <div
        className={cn(
          "ml-auto flex shrink-0 items-center gap-0.5",
          !warning &&
            "opacity-0 transition-opacity focus-within:opacity-100 group-hover/file:opacity-100",
        )}
        onClick={stopPlate}
        onMouseDown={stopPlate}
      >
        {action ? (
          <Button size="sm" variant="outline" onClick={action.onSelect}>
            {action.label}
          </Button>
        ) : null}
        {onReveal ? (
          <Hint label={REVEAL_LABEL}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={REVEAL_LABEL}
              onClick={onReveal}
            >
              <FolderOpenIcon />
            </Button>
          </Hint>
        ) : null}
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  variant={item.destructive ? "destructive" : "default"}
                  onSelect={item.onSelect}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

/** "Won't sync" in the file's details, with the reason on hover. */
export function UnsyncedTag({
  metadata,
  className,
}: {
  metadata: AttachmentSyncStatusLike;
  className?: string;
}) {
  const status = metadata.netherstoneSyncStatus;
  if (!status || status === "syncable") return null;

  return (
    <Hint label={describeUnsyncedFiles(status, [metadata])}>
      <span
        className={cn(
          "block w-fit text-amber-600 text-ui-sm dark:text-amber-400",
          className,
        )}
      >
        Won't sync
      </span>
    </Hint>
  );
}

/** A file's type and size, as "PDF · 1.2 MB". */
function describeFile(metadata: AttachmentSyncStatusLike) {
  const extension = metadata.netherstoneExtension?.trim().toUpperCase();
  const size = metadata.netherstoneSizeBytes;
  return [extension, typeof size === "number" ? formatBytes(size) : null]
    .filter(Boolean)
    .join(" · ");
}

/** Details for a file copied into the vault: type, size and whether it syncs. */
export function VaultFileDetails({
  metadata,
}: {
  metadata: AttachmentSyncStatusLike;
}) {
  const described = describeFile(metadata);
  const status = metadata.netherstoneSyncStatus;
  const syncs = !status || status === "syncable";
  return (
    <>
      {described}
      {syncs ? null : (
        <>
          {described ? " · " : null}
          <UnsyncedTag metadata={metadata} />
        </>
      )}
    </>
  );
}

/** Details for a file linked from this computer: other devices won't have it. */
export function LinkedFileDetails({
  metadata,
}: {
  metadata: AttachmentSyncStatusLike;
}) {
  const size = metadata.netherstoneSizeBytes;
  return (
    <Hint label="Other devices won't have this file.">
      <span className="inline-flex items-center gap-1">
        <LinkIcon className="size-3.5" />
        Linked
        {typeof size === "number" ? ` · ${formatBytes(size)}` : null}
      </span>
    </Hint>
  );
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * Looks up what the database knows about a missing attachment: the name it
 * was imported under, and a file with the same content if it was renamed.
 */
function useMissingAttachmentInfo(attachmentPath?: string | null) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [info, setInfo] = React.useState<MissingAttachmentInfo | null>(null);

  React.useEffect(() => {
    setInfo(null);
    if (!vaultPath || !attachmentPath) return;

    let cancelled = false;
    describeMissingAttachment(
      vaultPath,
      toVaultRelativePath(attachmentPath, vaultPath),
    )
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error) => {
        console.error("[Netherstone] Missing attachment lookup failed:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [attachmentPath, vaultPath]);

  return info;
}

/** The vault path of a file, as shown when hovering its name. */
export function useVaultRelativePath(path?: string | null) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  if (!path) return null;
  return vaultPath ? toVaultRelativePath(path, vaultPath) : path;
}

function NotFound({ hint }: { hint: string }) {
  return (
    <Hint label={hint}>
      <span className="text-amber-600 dark:text-amber-400">Not found</span>
    </Hint>
  );
}

/**
 * An attachment missing from the vault. When a file with the same content
 * turns up elsewhere in the vault, the row offers it.
 */
export function MissingVaultFileRow({
  name,
  attachmentPath,
  onRelink,
  onRelinkTo,
  onRemove,
}: {
  name?: string | null;
  attachmentPath?: string | null;
  onRelink?: () => void;
  /** Relinks to a file found in the vault with the same content. */
  onRelinkTo?: (absolutePath: string) => void;
  onRemove?: () => void;
}) {
  const info = useMissingAttachmentInfo(attachmentPath);
  const shownPath = useVaultRelativePath(attachmentPath);
  const foundPath = onRelinkTo ? (info?.foundAbsolutePath ?? null) : null;
  const findFile = onRelink
    ? { label: "Find file", onSelect: onRelink }
    : undefined;

  return (
    <MediaFileRow
      warning
      name={info?.originalName || name?.trim() || "Attachment"}
      nameHint={shownPath}
      details={
        <NotFound
          hint={
            foundPath
              ? "A file with the same content is in your vault."
              : "It was moved or deleted outside Netherstone."
          }
        />
      }
      action={
        foundPath && onRelinkTo
          ? {
              label: `Use ${getFileName(foundPath)}`,
              onSelect: () => onRelinkTo(foundPath),
            }
          : findFile
      }
      menu={[
        ...(foundPath && findFile ? [findFile] : []),
        ...(onRemove
          ? [{ label: "Remove", onSelect: onRemove, destructive: true }]
          : []),
      ]}
    />
  );
}

/** A file linked from this computer that isn't where it was. */
export function MissingLinkedFileRow({
  name,
  path,
  onLocate,
  onRemove,
}: {
  name?: string | null;
  path?: string | null;
  onLocate?: () => void;
  onRemove?: () => void;
}) {
  return (
    <MediaFileRow
      warning
      name={name?.trim() || (path ? getFileName(path) : "Linked file")}
      nameHint={path}
      details={
        <NotFound hint="It was moved, renamed or deleted on this computer." />
      }
      action={onLocate ? { label: "Find file", onSelect: onLocate } : undefined}
      menu={
        onRemove
          ? [{ label: "Remove", onSelect: onRemove, destructive: true }]
          : []
      }
    />
  );
}
