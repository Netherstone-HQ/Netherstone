import { invoke } from "@tauri-apps/api/core";

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
  return invoke<SyncReport>("sync_now", { vaultPath });
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

export function turnOffBackup(vaultPath: string) {
  return invoke<VaultSyncRecord>("sync_turn_off_backup", { vaultPath });
}

/** Mirrors the attachment policy's soft limit in `db/attachments.rs`. */
const ATTACHMENT_SYNC_LIMIT_BYTES = 20 * 1024 * 1024;

/** Why a file stays on this device, in plain words. */
export function describeSkipReason(file: SkippedFile) {
  switch (file.reason) {
    case "localOnly":
      return file.sizeBytes > ATTACHMENT_SYNC_LIMIT_BYTES
        ? "Larger than 20 MB"
        : "File type isn't backed up";
    case "blocked":
      return "Program files aren't backed up";
    case "pendingReview":
      return "File has no type";
    case "tooLarge":
      return "Larger than GitHub's 100 MB limit";
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

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
