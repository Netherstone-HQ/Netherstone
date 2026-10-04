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

function getStatus(
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

export function notifyAttachmentSyncStatus(items: AttachmentSyncStatusLike[]) {
  const statuses = items
    .map(getStatus)
    .filter(Boolean) as AttachmentSyncStatus[];

  if (statuses.length === 0) return;

  const blockedCount = statuses.filter((status) => status === "blocked").length;
  const localOnlyCount = statuses.filter(
    (status) => status === "local_only",
  ).length;
  const pendingReviewCount = statuses.filter(
    (status) => status === "pending_review",
  ).length;

  if (blockedCount > 0) {
    toast.warning("Some attachments need review", {
      description:
        blockedCount === 1
          ? "This file was added locally but is blocked from GitHub backup by policy."
          : `${blockedCount} files were added locally but are blocked from GitHub backup by policy.`,
    });
    return;
  }

  if (pendingReviewCount > 0) {
    toast.warning("Some attachments need review", {
      description:
        pendingReviewCount === 1
          ? "This file was added locally but needs review before GitHub backup."
          : `${pendingReviewCount} files were added locally but need review before GitHub backup.`,
    });
    return;
  }

  if (localOnlyCount > 0) {
    const localOnlyItems = items.filter(
      (item) => getStatus(item) === "local_only",
    );
    const oversizedCount = localOnlyItems.filter((item) => {
      const sizeBytes = getSizeBytes(item);
      return sizeBytes !== null && sizeBytes > 20 * 1024 * 1024;
    }).length;
    const extensions = Array.from(
      new Set(
        localOnlyItems
          .map(getExtension)
          .filter((extension) => extension.length > 0)
          .map((extension) => extension.toUpperCase()),
      ),
    );

    toast.info("Stored only on this device", {
      description:
        oversizedCount > 0
          ? localOnlyCount === 1
            ? "This attachment is over the GitHub backup size limit."
            : `${oversizedCount} attachments are over the GitHub backup size limit.`
          : extensions.length === 1
            ? `${extensions[0]} files are stored locally and are not backed up to GitHub by default.`
            : "These file types are stored locally and are not backed up to GitHub by default.",
    });
  }
}
