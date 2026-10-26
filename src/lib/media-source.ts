import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

import { fileExists, showLinkedFile } from "@/lib/commands";

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
  /** A file outside the vault the app hasn't been allowed to show yet. */
  isPending: boolean;
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

function isVaultManagedPath(
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

function canUseTauriConvertFileSrc(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Files outside the vault the app has asked to show. The app serves only the
 * vault until it is asked for another file, so a file's address is handed
 * out once it has been asked for, never before.
 */
const shownLocalFiles = new Set<string>();

function isPendingLocalFile(kind: MediaSourceKind, path: string | null) {
  return (
    kind === "local" &&
    path !== null &&
    canUseTauriConvertFileSrc() &&
    !shownLocalFiles.has(path)
  );
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
  if (isPendingLocalFile(kind, filePath)) {
    return "";
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
    isPending:
      !normalizeMediaSourceValue(options.explicitRenderUrl) &&
      isPendingLocalFile(kind, path),
  };
}

export async function resolveMediaSource(
  source: string | null | undefined,
  options: ResolveMediaSourceOptions = {},
): Promise<ResolvedMediaSource> {
  const base = resolveMediaSourceSync(source, options);

  if (base.isPending && base.path) {
    try {
      const exists = await showLinkedFile(base.path);
      if (exists) shownLocalFiles.add(base.path);

      return {
        ...resolveMediaSourceSync(source, options),
        status: exists ? "available" : "missing",
        isMissing: !exists,
      };
    } catch {
      return base;
    }
  }

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
