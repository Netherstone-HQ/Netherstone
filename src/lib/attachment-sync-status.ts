import { toast } from "sonner";

import type { PersistedAttachment } from "@/lib/commands";
import { formatSizeLimit } from "@/lib/sync";

export type AttachmentSyncStatus = PersistedAttachment["syncStatus"];

/** What Rust says about a file's sync: its type, size, status and limit. */
export type AttachmentSyncFacts = Pick<
  PersistedAttachment,
  "extension" | "sizeBytes" | "syncStatus" | "syncLimitBytes"
>;

/**
 * Why files that share a status stay on this device, naming their type when
 * they're all one type.
 */
export function describeUnsyncedFiles(
  status: Exclude<AttachmentSyncStatus, "syncable">,
  items: AttachmentSyncFacts[],
): string {
  const extensions = new Set(
    items
      .map((item) => item.extension.trim())
      .filter((extension) => extension.length > 0)
      .map((extension) => extension.toUpperCase()),
  );
  const type = extensions.size === 1 ? `${[...extensions][0]} files` : null;

  switch (status) {
    case "blocked":
      return `${type ?? "Apps and scripts"} stay on this device.`;
    case "pending_review":
      return "Files without a type stay on this device.";
    case "local_only": {
      const tooBig = items.find((item) => item.sizeBytes > item.syncLimitBytes);
      return tooBig
        ? `Files over ${formatSizeLimit(tooBig.syncLimitBytes)} stay on this device.`
        : `${type ?? "These file types"} stay on this device.`;
    }
  }
}

/** Says when files just added won't sync, most serious reason first. */
export function notifyAttachmentSyncStatus(items: AttachmentSyncFacts[]) {
  for (const status of ["blocked", "pending_review", "local_only"] as const) {
    const matching = items.filter((item) => item.syncStatus === status);
    if (matching.length === 0) continue;

    const notify = status === "local_only" ? toast.info : toast.warning;
    notify(
      matching.length === 1 ? "This file won't sync" : "Some files won't sync",
      { description: describeUnsyncedFiles(status, matching) },
    );
    return;
  }
}
