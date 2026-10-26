import { invoke } from "@tauri-apps/api/core";
import { useHistoryStore } from "@/store/history";

export type VaultSyncRecord = {
  vaultId: string;
  vaultPath: string;
  syncEnabled: boolean;
  remoteUrl: string | null;
  /** `owner/name` of the backup repository on GitHub. */
  repoName: string | null;
  branch: string;
  lastCommit: string | null;
  lastCommitAt: number | null;
  /** Unix seconds of the last successful sync. */
  lastSyncAt: number | null;
  /** Files changed here and on GitHub, waiting for a decision. */
  conflicts: SyncConflict[];
};

export type SyncConflict = {
  /** Vault-relative path with `/` separators. */
  path: string;
  /** Blob id of GitHub's version. */
  theirs: string;
  detectedAt: number;
};

export type SyncReport = {
  record: VaultSyncRecord;
  /** Vault-relative paths changed by changes from GitHub. */
  changed: string[];
};

export type ConflictChoice = "gitHub" | "thisDevice" | "both";

export type ConflictVersions = {
  path: string;
  /** `null` when the file isn't text, or is gone from this device. */
  thisDevice: string | null;
  github: string | null;
  thisDeviceBytes: number | null;
  githubBytes: number;
};

export type BackupSummary = {
  fullName: string;
  name: string;
  cloneUrl: string;
  pushedAt: string | null;
};

export type SkipReason =
  | "localOnly"
  | "blocked"
  | "pendingReview"
  | "tooLarge"
  | "unmanaged";

export type SkippedFile = {
  path: string;
  sizeBytes: number;
  reason: SkipReason;
  /** The size limit behind `reason`, when it is about size. */
  limitBytes: number | null;
};

export type SyncPlanSummary = {
  includedCount: number;
  shardCount: number;
  drawingCount: number;
  attachmentCount: number;
  includedBytes: number;
  skipped: SkippedFile[];
};

/** The vault's sync record, or `null` if backup was never set up for it. */
export function getVaultSyncRecord(vaultPath: string) {
  return invoke<VaultSyncRecord | null>("sync_get_vault_record", { vaultPath });
}

export function planVaultSync(vaultPath: string) {
  return invoke<SyncPlanSummary>("sync_plan_vault", { vaultPath });
}

export function turnOnBackup(vaultPath: string) {
  return invoke<SyncReport>("sync_turn_on_backup", { vaultPath });
}

export function syncNow(vaultPath: string) {
  return invoke<SyncReport>("sync_now", { vaultPath }).then((report) => {
    // Saved a version, or brought in other devices' versions.
    useHistoryStore.getState().versionsChanged();
    return report;
  });
}

export function listBackups() {
  return invoke<BackupSummary[]>("sync_list_backups");
}

export function connectBackup(vaultPath: string, backup: BackupSummary) {
  return invoke<SyncReport>("sync_connect_backup", {
    vaultPath,
    fullName: backup.fullName,
    cloneUrl: backup.cloneUrl,
  });
}

export function getConflictVersions(vaultPath: string, path: string) {
  return invoke<ConflictVersions>("sync_get_conflict_versions", { vaultPath, path });
}

export function resolveConflict(
  vaultPath: string,
  path: string,
  choice: ConflictChoice,
) {
  return invoke<VaultSyncRecord>("sync_resolve_conflict", { vaultPath, path, choice });
}

/** Network failures from the backend all start with this sentence. */
export function isOfflineError(message: string) {
  return message.startsWith("Couldn't reach GitHub");
}

/** `Folder/Note.md` → `Note.md`. */
export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

type VaultSnapshotResult = { commit: unknown | null };

/** Tells an open history panel when a version was saved. */
function noteVersion(result: VaultSnapshotResult) {
  if (result.commit) useHistoryStore.getState().versionsChanged();
  return result;
}

/** Saves a version of the vault in its local history, if anything changed. */
export function saveVaultVersion(vaultPath: string) {
  return invoke<VaultSnapshotResult>("sync_snapshot_vault", { vaultPath }).then(
    noteVersion,
  );
}

/**
 * Saves `previous`, the text the app last saved to `filePath`, and then the
 * outside change now on disk, as versions of the vault.
 */
export function saveOutsideChangeVersion(
  vaultPath: string,
  filePath: string,
  previous: string,
) {
  return invoke<VaultSnapshotResult>("sync_snapshot_outside_change", {
    vaultPath,
    filePath,
    previous,
  }).then(noteVersion);
}

export function turnOffBackup(vaultPath: string) {
  return invoke<VaultSyncRecord>("sync_turn_off_backup", { vaultPath });
}

/** Why a file stays on this device, in plain words. */
export function describeSkipReason(file: SkippedFile) {
  switch (file.reason) {
    case "localOnly":
      return file.limitBytes !== null && file.sizeBytes > file.limitBytes
        ? `Larger than ${formatSizeLimit(file.limitBytes)}`
        : "This file type doesn't sync";
    case "blocked":
      return "Apps and scripts don't sync";
    case "pendingReview":
      return "File has no type";
    case "tooLarge":
      return file.limitBytes === null
        ? "Larger than GitHub's limit"
        : `Larger than GitHub's ${formatSizeLimit(file.limitBytes)} limit`;
    case "unmanaged":
      return "Not a shard, drawing or attachment";
  }
}

export function describeBackupContents(plan: SyncPlanSummary) {
  const parts = [
    [plan.shardCount, "shard", "shards"],
    [plan.drawingCount, "drawing", "drawings"],
    [plan.attachmentCount, "attachment", "attachments"],
  ] as const;
  const named = parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);

  if (named.length === 0) return "No files yet";
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** A size limit in whole megabytes, as "20 MB". */
export function formatSizeLimit(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
