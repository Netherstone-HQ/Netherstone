import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

import { fileExists } from "@/lib/commands";

export type AssetSourceKind = "remote" | "vault" | "local";
export type MediaSourceKind = AssetSourceKind | "blob" | "data" | "unknown";
export type MediaSourceStatus = "available" | "missing" | "unknown";

export interface ResolveMediaSourceOptions {
  vaultPath?: string | null;
  checkExistence?: boolean;
  explicitRenderUrl?: string | null;
}

export interface ResolvedMediaSource {
  source: string;
  kind: MediaSourceKind;
  status: MediaSourceStatus;
  path: string | null;
  renderUrl: string;
  openTarget: string;
  isMissing: boolean;
  isMachineLocal: boolean;
  isPortable: boolean;
  isVaultManaged: boolean;
}

const REMOTE_URL_RE = /^(https?:|mailto:|tel:|ftp:)/i;
const DATA_URL_RE = /^data:/i;
const BLOB_URL_RE = /^blob:/i;
const FILE_URL_RE = /^file:/i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const UNC_PATH_RE = /^\\\\/;
const POSIX_ABSOLUTE_PATH_RE = /^\//;

export function normalizeMediaSourceValue(
  source: string | null | undefined,
): string {
  return typeof source === "string" ? source.trim() : "";
}

export function normalizePathSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

export function isRemoteMediaSource(
  source: string | null | undefined,
): boolean {
  const normalized = normalizeMediaSourceValue(source);
  return REMOTE_URL_RE.test(normalized);
}

export function isDataMediaSource(source: string | null | undefined): boolean {
  const normalized = normalizeMediaSourceValue(source);
  return DATA_URL_RE.test(normalized);
}

export function isBlobMediaSource(source: string | null | undefined): boolean {
  const normalized = normalizeMediaSourceValue(source);
  return BLOB_URL_RE.test(normalized);
}

export function isFileProtocolSource(
  source: string | null | undefined,
): boolean {
  const normalized = normalizeMediaSourceValue(source);
  return FILE_URL_RE.test(normalized);
}

export function isAbsoluteFilesystemPath(
  source: string | null | undefined,
): boolean {
  const normalized = normalizeMediaSourceValue(source);

  return (
    WINDOWS_ABSOLUTE_PATH_RE.test(normalized) ||
    UNC_PATH_RE.test(normalized) ||
    POSIX_ABSOLUTE_PATH_RE.test(normalized)
  );
}

export function isVaultAttachmentReference(
  source: string | null | undefined,
): boolean {
  const normalized = normalizeMediaSourceValue(source).replace(/^\.\//, "");

  return (
    normalized === "_attachments" ||
    normalized.startsWith("_attachments/") ||
    normalized.startsWith("_attachments\\")
  );
}

export function resolveVaultAttachmentPath(
  source: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const normalizedSource = normalizeMediaSourceValue(source).replace(
    /^\.\//,
    "",
  );
  const normalizedVaultPath = normalizeMediaSourceValue(vaultPath);

  if (!normalizedSource || !normalizedVaultPath) return null;
  if (!isVaultAttachmentReference(normalizedSource)) return null;

  const vaultRoot = normalizePathSlashes(normalizedVaultPath).replace(
    /\/+$/,
    "",
  );
  const attachmentPath = normalizePathSlashes(normalizedSource).replace(
    /^\/+/,
    "",
  );

  return `${vaultRoot}/${attachmentPath}`;
}

export function pathFromFileUrl(source: string): string | null {
  try {
    const url = new URL(source);

    if (url.protocol !== "file:") return null;

    const pathname = decodeURIComponent(url.pathname);

    if (url.hostname && url.hostname !== "localhost") {
      return `//${url.hostname}${pathname}`;
    }

    if (/^\/[a-zA-Z]:\//.test(pathname)) {
      return pathname.slice(1);
    }

    return pathname;
  } catch {
    return null;
  }
}

export function getFilesystemPathFromMediaSource(
  source: string | null | undefined,
  options: Pick<ResolveMediaSourceOptions, "vaultPath"> = {},
): string | null {
  const normalized = normalizeMediaSourceValue(source);

  if (!normalized) return null;

  if (isFileProtocolSource(normalized)) {
    return pathFromFileUrl(normalized);
  }

  if (isAbsoluteFilesystemPath(normalized)) {
    return normalized;
  }

  const vaultAttachmentPath = resolveVaultAttachmentPath(
    normalized,
    options.vaultPath,
  );
  if (vaultAttachmentPath) {
    return vaultAttachmentPath;
  }

  return null;
}

export function isVaultManagedPath(
  filePath: string | null | undefined,
  vaultPath: string | null | undefined,
): boolean {
  const normalizedFilePath = normalizeMediaSourceValue(filePath);
  const normalizedVaultPath = normalizeMediaSourceValue(vaultPath);

  if (!normalizedFilePath || !normalizedVaultPath) return false;

  const file = normalizePathSlashes(normalizedFilePath);
  const attachmentsRoot = `${normalizePathSlashes(normalizedVaultPath).replace(
    /\/+$/,
    "",
  )}/_attachments`;

  return file === attachmentsRoot || file.startsWith(`${attachmentsRoot}/`);
}

export function getVaultAttachmentReference(
  filePath: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const normalizedFilePath = normalizeMediaSourceValue(filePath);
  const normalizedVaultPath = normalizeMediaSourceValue(vaultPath);

  if (!normalizedFilePath || !normalizedVaultPath) return null;
  if (!isVaultManagedPath(normalizedFilePath, normalizedVaultPath)) return null;

  const file = normalizePathSlashes(normalizedFilePath);
  const vault = normalizePathSlashes(normalizedVaultPath).replace(/\/+$/, "");

  return file.slice(vault.length + 1);
}

function stripPathExtension(path: string): string {
  const lastSlashIndex = path.lastIndexOf("/");
  const lastDotIndex = path.lastIndexOf(".");

  if (lastDotIndex <= lastSlashIndex) {
    return path;
  }

  return path.slice(0, lastDotIndex);
}

export function getVaultRelativePath(
  filePath: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const normalizedFilePath = normalizeMediaSourceValue(filePath);
  const normalizedVaultPath = normalizeMediaSourceValue(vaultPath);

  if (!normalizedFilePath || !normalizedVaultPath) return null;

  const file = normalizePathSlashes(normalizedFilePath);
  const vault = normalizePathSlashes(normalizedVaultPath).replace(/\/+$/, "");

  if (file === vault) return "";
  if (!file.startsWith(`${vault}/`)) return null;

  return file.slice(vault.length + 1);
}

export function getShardAttachmentDirectoryReference(
  shardPath: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const relativeShardPath = getVaultRelativePath(shardPath, vaultPath);
  if (relativeShardPath === null) return null;

  const normalizedRelativeShardPath = normalizePathSlashes(relativeShardPath)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const shardStem = stripPathExtension(normalizedRelativeShardPath);

  return shardStem ? `_attachments/${shardStem}` : "_attachments";
}

export function resolveShardAttachmentDirectoryPath(
  shardPath: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const attachmentReference = getShardAttachmentDirectoryReference(
    shardPath,
    vaultPath,
  );
  const normalizedVaultPath = normalizeMediaSourceValue(vaultPath);

  if (!attachmentReference || !normalizedVaultPath) return null;

  const vaultRoot = normalizePathSlashes(normalizedVaultPath).replace(
    /\/+$/,
    "",
  );

  return `${vaultRoot}/${attachmentReference}`;
}

export function getShardScopedAttachmentReference(
  fileName: string | null | undefined,
  shardPath: string | null | undefined,
  vaultPath: string | null | undefined,
): string | null {
  const attachmentDirectory = getShardAttachmentDirectoryReference(
    shardPath,
    vaultPath,
  );
  const normalizedFileName = normalizeMediaSourceValue(fileName)
    .replace(/\\/g, "/")
    .split("/")
    .pop();

  if (!attachmentDirectory || !normalizedFileName) return null;

  return `${attachmentDirectory}/${normalizedFileName}`;
}

export function getMediaSourceKind(
  source: string | null | undefined,
  options: Pick<ResolveMediaSourceOptions, "vaultPath"> = {},
): MediaSourceKind {
  const normalized = normalizeMediaSourceValue(source);

  if (!normalized) return "unknown";
  if (isBlobMediaSource(normalized)) return "blob";
  if (isDataMediaSource(normalized)) return "data";
  if (isRemoteMediaSource(normalized)) return "remote";

  const filePath = getFilesystemPathFromMediaSource(normalized, options);
  if (!filePath) return "unknown";

  return isVaultManagedPath(filePath, options.vaultPath) ? "vault" : "local";
}

export function isMachineLocalMediaSource(kind: MediaSourceKind): boolean {
  return kind === "vault" || kind === "local" || kind === "blob";
}

export function isPortableMediaSource(kind: MediaSourceKind): boolean {
  return kind === "remote" || kind === "data" || kind === "vault";
}

function canUseTauriConvertFileSrc(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function resolveMediaRenderUrl(
  source: string | null | undefined,
  options: Pick<
    ResolveMediaSourceOptions,
    "explicitRenderUrl" | "vaultPath"
  > = {},
): string {
  const explicitRenderUrl = normalizeMediaSourceValue(
    options.explicitRenderUrl,
  );
  if (explicitRenderUrl) return explicitRenderUrl;

  const normalized = normalizeMediaSourceValue(source);
  const kind = getMediaSourceKind(normalized, options);

  if (!normalized) return "";

  if (kind === "remote" || kind === "data" || kind === "blob") {
    return normalized;
  }

  const filePath = getFilesystemPathFromMediaSource(normalized, options);
  if (!filePath) {
    return normalized;
  }

  if (!canUseTauriConvertFileSrc()) {
    return filePath;
  }

  try {
    return convertFileSrc(filePath);
  } catch {
    return filePath;
  }
}

export function resolveMediaOpenTarget(
  source: string | null | undefined,
  options: Pick<ResolveMediaSourceOptions, "vaultPath"> = {},
): string {
  const normalized = normalizeMediaSourceValue(source);
  const kind = getMediaSourceKind(normalized, options);

  if (!normalized) return "";
  if (kind === "remote" || kind === "data" || kind === "blob") {
    return normalized;
  }

  return getFilesystemPathFromMediaSource(normalized, options) ?? normalized;
}

export function resolveMediaSourceSync(
  source: string | null | undefined,
  options: Pick<
    ResolveMediaSourceOptions,
    "explicitRenderUrl" | "vaultPath"
  > = {},
): ResolvedMediaSource {
  const normalized = normalizeMediaSourceValue(source);
  const kind = getMediaSourceKind(normalized, options);
  const path =
    kind === "vault" || kind === "local"
      ? getFilesystemPathFromMediaSource(normalized, options)
      : null;

  return {
    source: normalized,
    kind,
    status:
      kind === "vault" || kind === "local"
        ? "unknown"
        : normalized
          ? "available"
          : "unknown",
    path,
    renderUrl: resolveMediaRenderUrl(normalized, options),
    openTarget: resolveMediaOpenTarget(normalized, options),
    isMissing: false,
    isMachineLocal: isMachineLocalMediaSource(kind),
    isPortable: isPortableMediaSource(kind),
    isVaultManaged: kind === "vault",
  };
}

export async function resolveMediaSource(
  source: string | null | undefined,
  options: ResolveMediaSourceOptions = {},
): Promise<ResolvedMediaSource> {
  const base = resolveMediaSourceSync(source, options);

  if (!options.checkExistence || !base.path) {
    return base;
  }

  try {
    const exists = await fileExists(base.path);

    return {
      ...base,
      status: exists ? "available" : "missing",
      isMissing: !exists,
    };
  } catch {
    return {
      ...base,
      status: "unknown",
      isMissing: false,
    };
  }
}
