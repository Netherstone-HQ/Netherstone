import { invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

export type MediaDialogKind = "audio" | "file" | "image" | "video";

export interface PersistedAttachment {
  assetPath: string;
  absolutePath: string;
  hash: string;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  syncStatus: "syncable" | "local_only" | "blocked" | "pending_review";
  /** The size above which files stay on this device. */
  syncLimitBytes: number;
}

/** A file shards link to that is not in the vault. */
export interface MissingAttachment {
  assetPath: string;
  shardPaths: string[];
  /** The name the file was imported under, if known. */
  originalName: string | null;
  /** A file in the vault with the same content, to relink to. */
  foundAssetPath: string | null;
}

export interface CleanupResult {
  removed: string[];
  freedBytes: number;
  /** Requested files kept because they are linked again or not removable. */
  kept: string[];
}

/** Matches CLEANUP_GRACE_SECONDS in the backend. */
export const CLEANUP_GRACE_DAYS = 7;

/**
 * The original name of a missing attachment and, when a file with the same
 * content is in the vault (it was renamed or moved), where it is now.
 */
export interface MissingAttachmentInfo {
  originalName: string | null;
  foundAssetPath: string | null;
  foundAbsolutePath: string | null;
}

/** A file in the attachment folder that no shard links to. */
export interface UnusedAttachment {
  assetPath: string;
  sizeBytes: number;
  /** When it was first seen unused, in unix seconds. */
  unusedSince: number | null;
}

export interface AttachmentReport {
  fileCount: number;
  totalBytes: number;
  missing: MissingAttachment[];
  unused: UnusedAttachment[];
  registeredCount: number;
  removedShardCount: number;
  /** Files shards link to outside the attachment folder. */
  externalFiles: ExternalFile[];
}

export interface ExternalFile {
  absolutePath: string;
  sizeBytes: number;
  insideVault: boolean;
  /** Each shard that links to the file, with the link as written. */
  uses: { shardPath: string; link: string }[];
}

/**
 * Opens a native OS media/file picker and returns absolute filesystem paths
 * for the selected items.
 */
export async function openMediaFilesDialog(
  mediaKind: MediaDialogKind = "file",
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("open_media_files_dialog", { mediaKind });
}

/**
 * Persists a local file into the vault-managed `_attachments` store.
 * Returns durable attachment metadata for markdown insertion and UI status.
 */
export async function persistAttachmentFile(
  sourcePath: string,
  vaultPath: string,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("persist_attachment_file", {
    sourcePath,
    vaultPath,
  });
}

/**
 * Asks the user, in a native dialog, before files outside the vault that
 * aren't pictures, sound or video are copied into it. Resolves whether all
 * of them may be copied now; nothing is asked when none need it.
 */
export async function confirmAttachmentCopies(
  paths: string[],
): Promise<boolean> {
  assertTauri();
  return invoke<boolean>("confirm_attachment_copies", { paths });
}

export async function persistAttachmentBytes(
  fileName: string,
  bytes: Uint8Array,
  vaultPath: string,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("persist_attachment_bytes", bytes, {
    headers: {
      "x-file-name": encodeURIComponent(fileName),
      "x-vault-path": encodeURIComponent(vaultPath),
    },
  });
}

/**
 * Re-checks the vault's attachments against its shards and attachment folder,
 * repairs the database, and reports missing and unused files.
 */
export async function reconcileAttachments(
  vaultPath: string,
): Promise<AttachmentReport> {
  assertTauri();
  return invoke<AttachmentReport>("reconcile_attachments", { vaultPath });
}

/**
 * Moves unused attachments to the OS trash. The backend re-checks each file
 * first and keeps any that are linked again or unused for less than
 * CLEANUP_GRACE_DAYS.
 */
export async function cleanUpAttachments(
  vaultPath: string,
  assetPaths: string[],
): Promise<CleanupResult> {
  assertTauri();
  return invoke<CleanupResult>("clean_up_attachments", {
    vaultPath,
    assetPaths,
  });
}

/** A vault attachment's type, size and whether it syncs, as it is now. */
export interface AttachmentSyncInfo {
  extension: string;
  sizeBytes: number;
  syncStatus: PersistedAttachment["syncStatus"];
  syncLimitBytes: number;
}

type SyncInfoAsk = {
  promise: Promise<AttachmentSyncInfo | null>;
  resolve: (info: AttachmentSyncInfo | null) => void;
  reject: (error: unknown) => void;
};

/** Asks not yet sent, by vault, then by attachment. */
const pendingSyncInfo = new Map<string, Map<string, SyncInfoAsk>>();

/**
 * What the sync rules say about a vault attachment today, or null when it's
 * gone. Every file block asks as it shows, so asks made in the same turn go
 * to the backend together: a shard asks once for all its files when it opens.
 */
export async function attachmentSyncInfo(
  vaultPath: string,
  assetPath: string,
): Promise<AttachmentSyncInfo | null> {
  assertTauri();
  let batch = pendingSyncInfo.get(vaultPath);
  if (!batch) {
    batch = new Map();
    pendingSyncInfo.set(vaultPath, batch);
    queueMicrotask(() => sendSyncInfoAsks(vaultPath));
  }

  let ask = batch.get(assetPath);
  if (!ask) {
    let resolve!: SyncInfoAsk["resolve"];
    let reject!: SyncInfoAsk["reject"];
    const promise = new Promise<AttachmentSyncInfo | null>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    ask = { promise, resolve, reject };
    batch.set(assetPath, ask);
  }
  return ask.promise;
}

function sendSyncInfoAsks(vaultPath: string) {
  const batch = pendingSyncInfo.get(vaultPath);
  pendingSyncInfo.delete(vaultPath);
  if (!batch) return;

  const asks = [...batch.values()];
  invoke<(AttachmentSyncInfo | null)[]>("attachment_sync_infos", {
    vaultPath,
    assetPaths: [...batch.keys()],
  })
    .then((infos) => {
      asks.forEach((ask, index) => ask.resolve(infos[index] ?? null));
    })
    .catch((error) => {
      for (const ask of asks) ask.reject(error);
    });
}

export async function describeMissingAttachment(
  vaultPath: string,
  assetPath: string,
): Promise<MissingAttachmentInfo> {
  assertTauri();
  return invoke<MissingAttachmentInfo>("describe_missing_attachment", {
    vaultPath,
    assetPath,
  });
}

/**
 * Checks whether a file or directory currently exists on disk.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  assertTauri();
  return invoke<boolean>("file_exists", { filePath });
}

/**
 * Lets a shard show a picture, sound or video file from anywhere on this
 * device, as a pasted or linked file. False when the file isn't there.
 */
export async function showLinkedFile(filePath: string): Promise<boolean> {
  assertTauri();
  return invoke<boolean>("show_linked_file", { filePath });
}

/**
 * Opens a file a shard links to in the app this device uses for it.
 * Programs, scripts and shortcuts are refused.
 */
export async function openFile(path: string): Promise<void> {
  assertTauri();
  return invoke<void>("open_file", { path });
}
