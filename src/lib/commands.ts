import { invoke } from "@tauri-apps/api/core";
import type { FileTreeNode } from "@/store";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Environment guard ─────────────────────────────────────────────────────────

function assertTauri(): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "[Netherstone] Tauri internals not found.\n" +
        "Run the app with `pnpm tauri dev`, not `pnpm dev`.\n" +
        "Tauri commands are only available inside the native webview.",
    );
  }
}

// ── Vault ─────────────────────────────────────────────────────────────────────

/**
 * Opens the native OS folder picker dialog.
 * Returns the selected folder path, or null if the user cancelled.
 */
export async function openVaultDialog(): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("open_vault_dialog");
}

/**
 * Makes `vaultPath` the open vault on the Rust side, which refuses to touch
 * files anywhere else. It must be a vault already, or a folder just picked
 * or created.
 */
export async function setOpenVault(vaultPath: string): Promise<void> {
  assertTauri();
  return invoke("open_vault", { vaultPath });
}

/**
 * Recursively scans a vault directory for .md and .excalidraw files and returns the
 * file tree sorted with directories first, then files, both alphabetically.
 */
export async function scanVault(vaultPath: string): Promise<FileTreeNode[]> {
  assertTauri();
  return invoke<FileTreeNode[]>("scan_vault", { vaultPath });
}

/** Another vault that a folder is inside, or that is inside it. */
export type NestedVault = {
  path: string;
  /** The folder is inside this vault; otherwise this vault is inside it. */
  containsFolder: boolean;
};

/**
 * Another vault around or inside `folder`, which may not exist yet, or null
 * when there is none.
 */
export async function findNestedVault(
  folder: string,
): Promise<NestedVault | null> {
  assertTauri();
  return invoke<NestedVault | null>("find_nested_vault", { folder });
}

/** The folder new vaults go in unless the user picks another: Documents. */
export async function defaultVaultLocation(): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("default_vault_location");
}

/**
 * Creates the folder for a new vault in `parent` and returns its path. Fails
 * with one of the codes in `VaultFolderError` instead of a sentence.
 */
export async function createVault(parent: string, name: string): Promise<string> {
  assertTauri();
  return invoke<string>("create_vault", { parent, name });
}

export type VaultFolderError =
  | "vault-name-empty"
  | "vault-name-invalid"
  | "vault-folder-not-empty"
  | "vault-location-missing";

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

// ── Shards ────────────────────────────────────────────────────────────────────

/**
 * Copies a shard from outside the vault into the vault root.
 * Returns the path of the newly created file inside the vault.
 */
export async function importShard(
  sourcePath: string,
  vaultPath: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("import_shard", { sourcePath, vaultPath });
}

/** A file found for importing: its path, and its path under what was picked. */
export interface ImportSourceFile {
  path: string;
  relativePath: string;
  size: number;
}

/** Asks for files, or one folder, to import. Empty when cancelled. */
export async function pickImportPaths(folder: boolean): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("open_import_dialog", { folder });
}

/** Every file in the picked files and folders, hidden ones left out. */
export async function listImportSources(
  paths: string[],
): Promise<ImportSourceFile[]> {
  assertTauri();
  return invoke<ImportSourceFile[]>("list_import_sources", { paths });
}

export async function readImportFile(path: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_import_file", { path }));
}

/**
 * Takes an import back: its shards go to the trash like deleted ones, then
 * the attachments it brought in that nothing else links to. `since` is when
 * the import started, in unix seconds.
 */
export async function undoImport(
  vaultPath: string,
  targetDir: string,
  shardPaths: string[],
  assetPaths: string[],
  since: number,
): Promise<void> {
  assertTauri();
  await invoke("undo_import", { vaultPath, targetDir, shardPaths, assetPaths, since });
}

/** Free shard paths in `targetDir`, one per `Folder/Name`, never existing files. */
export async function reserveImportPaths(
  targetDir: string,
  relativePaths: string[],
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("reserve_import_paths", { targetDir, relativePaths });
}

/**
 * Writes an imported shard at `filePath`, or at the next free name when that
 * was taken since it was reserved. Returns where it went.
 */
export async function saveImportedShard(
  vaultPath: string,
  filePath: string,
  content: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("save_imported_shard", { vaultPath, filePath, content });
}

/** Points the links in `shardPaths` to `oldPath` at `newPath`. */
export async function fixImportedLinks(
  shardPaths: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  assertTauri();
  await invoke("fix_imported_links", { shardPaths, oldPath, newPath });
}

/** Copies a file an imported shard uses into the vault's attachments. */
export async function importAttachment(
  path: string,
  vaultPath: string,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("import_attachment", { path, vaultPath });
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

/**
 * The original name of a missing attachment and, when a file with the same
 * content is in the vault (it was renamed or moved), where it is now.
 */
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

export async function readMarkdownFile(filePath: string): Promise<string> {
  assertTauri();
  return invoke<string>("read_markdown_file", { filePath });
}

/**
 * Atomically writes a shard and refreshes its attachment references.
 */
export async function saveMarkdownFile(
  filePath: string,
  content: string,
): Promise<void> {
  assertTauri();
  return invoke("save_markdown_file", { filePath, content });
}

export async function appendMarkdownToFile(
  filePath: string,
  markdown: string,
): Promise<void> {
  assertTauri();
  return invoke("append_markdown_to_file", { filePath, markdown });
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

// ── Drawings ──────────────────────────────────────────────────────────────────

/** Reads the raw JSON of a `.excalidraw` drawing in the vault. */
export async function readDrawingFile(filePath: string): Promise<string> {
  assertTauri();
  return invoke<string>("read_drawing_file", { filePath });
}

/**
 * Atomically writes a `.excalidraw` drawing's JSON. With `expectedContent`,
 * the drawing as the app last read or wrote it, the save is refused if the
 * file changed outside the app since (see `isChangedOnDiskError`).
 */
export async function saveDrawingFile(
  filePath: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  assertTauri();
  return invoke("save_drawing_file", { filePath, content, expectedContent });
}

export type MergedDrawing = {
  content: string;
  /** A shape changed on both sides; ours was kept. */
  conflicted: boolean;
};

/**
 * Merges `ours` and `theirs`, two versions of the drawing `base`, shape by
 * shape. Null when one of them isn't a drawing.
 */
export async function mergeDrawings(
  base: string,
  ours: string,
  theirs: string,
): Promise<MergedDrawing | null> {
  assertTauri();
  return invoke<MergedDrawing | null>("merge_drawings", { base, ours, theirs });
}

/**
 * Creates an empty drawing called `name` in `directory`, adding a numeric
 * suffix if the name is taken. Returns the new file's path.
 */
export async function createDrawingFile(
  directory: string,
  name: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("create_drawing_file", { directory, name });
}

/**
 * Returns the shards in the vault whose text contains any of `needles`, such
 * as the notes that embed an exported drawing.
 */
export async function findShardsContaining(
  vaultPath: string,
  needles: string[],
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("find_shards_containing", { vaultPath, needles });
}

// ── Watcher ───────────────────────────────────────────────────────────────────

/**
 * Starts a debounced file watcher on the given vault directory.
 * Fires a `vault:changed` event whenever .md or .excalidraw files, folders,
 * or files in `_attachments` are added, removed, or renamed.
 */
export async function startVaultWatcher(vaultPath: string): Promise<void> {
  assertTauri();
  return invoke("start_vault_watcher", { vaultPath });
}

/**
 * Stops the active file watcher, if any.
 */
export async function stopVaultWatcher(): Promise<void> {
  assertTauri();
  return invoke("stop_vault_watcher");
}


// ── Exports ───────────────────────────────────────────────────────────────────

export type ExportFileFormat = "html" | "pdf" | "docx";

/**
 * Asks where to save an export. Returns the path, with the format's
 * extension, or null if the user cancelled.
 */
export async function chooseExportPath(
  defaultName: string,
  format: ExportFileFormat,
  defaultDirectory?: string | null,
): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("choose_export_path", {
    defaultName,
    format,
    defaultDirectory: defaultDirectory ?? null,
  });
}

/** Writes a finished export to `path`, replacing any file there. */
export async function writeExportFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  assertTauri();
  await invoke("write_export_file", bytes, {
    headers: { "x-export-path": encodeURIComponent(path) },
  });
}

/** Reads a file on this computer that an export embeds. */
export async function readExportAsset(path: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_export_asset", { path }));
}

/** Downloads an image from the web that an export embeds. */
export async function fetchExportAsset(url: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("fetch_export_asset", { url }));
}

/** Paper and margins of a PDF export, in millimetres. */
export interface PdfPageSetup {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

/** Prints an export's HTML to a PDF at `path` through the system webview. */
export async function exportPdf(html: string, path: string, page: PdfPageSetup): Promise<void> {
  assertTauri();
  await invoke("export_pdf", new TextEncoder().encode(html), {
    headers: {
      "x-export-path": encodeURIComponent(path),
      "x-export-page": encodeURIComponent(JSON.stringify(page)),
    },
  });
}
