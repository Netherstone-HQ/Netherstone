import { toast } from "sonner";

import type { PersistedAttachment } from "@/lib/commands";

export type AttachmentSyncStatus = PersistedAttachment["syncStatus"];

export type AttachmentSyncStatusLike = {
  netherstoneExtension?: string;
  netherstoneSizeBytes?: number;
  netherstoneSyncStatus?: AttachmentSyncStatus;
  extension?: string;
  sizeBytes?: number;
  syncStatus?: AttachmentSyncStatus;
};

/** Mirrors the attachment policy's soft limit in `db/attachments.rs`. */
export const ATTACHMENT_SYNC_LIMIT_BYTES = 20 * 1024 * 1024;

function getAttachmentSyncStatus(
  value: AttachmentSyncStatusLike,
): AttachmentSyncStatus | null {
  return value.netherstoneSyncStatus ?? value.syncStatus ?? null;
}

function getSizeBytes(value: AttachmentSyncStatusLike): number | null {
  const size = value.netherstoneSizeBytes ?? value.sizeBytes;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

function getExtension(value: AttachmentSyncStatusLike): string {
  return (value.netherstoneExtension ?? value.extension ?? "").trim();
}

/**
 * Why files that share a status stay on this device, naming their type when
 * they're all one type.
 */
export function describeUnsyncedFiles(
  status: Exclude<AttachmentSyncStatus, "syncable">,
  items: AttachmentSyncStatusLike[],
): string {
  const extensions = new Set(
    items
      .map(getExtension)
      .filter((extension) => extension.length > 0)
      .map((extension) => extension.toUpperCase()),
  );
  const type = extensions.size === 1 ? `${[...extensions][0]} files` : null;

  switch (status) {
    case "blocked":
      return `${type ?? "Apps and scripts"} stay on this device.`;
    case "pending_review":
      return "Files without a type stay on this device.";
    case "local_only":
      return items.some(
        (item) => (getSizeBytes(item) ?? 0) > ATTACHMENT_SYNC_LIMIT_BYTES,
      )
        ? "Files over 20 MB stay on this device."
        : `${type ?? "These file types"} stay on this device.`;
  }
}

/** Says when files just added won't sync, most serious reason first. */
export function notifyAttachmentSyncStatus(items: AttachmentSyncStatusLike[]) {
  for (const status of ["blocked", "pending_review", "local_only"] as const) {
    const matching = items.filter(
      (item) => getAttachmentSyncStatus(item) === status,
    );
    if (matching.length === 0) continue;

    const notify = status === "local_only" ? toast.info : toast.warning;
    notify(
      matching.length === 1 ? "This file won't sync" : "Some files won't sync",
      { description: describeUnsyncedFiles(status, matching) },
    );
    return;
  }
}
