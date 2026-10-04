export type VaultChangeSuppressionReason =
  | "autosave"
  | "manual-save"
  | "close-save"
  | "rename"
  | "move"
  | "app-initiated"
  | (string & {});

export type SuppressVaultChangeOptions = {
  durationMs?: number;
  reason?: VaultChangeSuppressionReason;
};

export type PartitionedVaultChangePaths = {
  suppressedPaths: string[];
  unsuppressedPaths: string[];
};

type VaultChangeSuppressionEntry = {
  expiresAt: number;
  reason: VaultChangeSuppressionReason;
};

const DEFAULT_VAULT_CHANGE_SUPPRESSION_MS = 2_500;

const suppressionByPath = new Map<string, VaultChangeSuppressionEntry>();

function now(): number {
  return window.performance.now();
}

function normalizeVaultPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\\/g, "/");
}

function cleanupExpiredSuppressions(currentTime = now()): void {
  for (const [path, entry] of suppressionByPath.entries()) {
    if (entry.expiresAt <= currentTime) {
      suppressionByPath.delete(path);
    }
  }
}

function getNormalizedUniquePaths(paths: Iterable<string>): string[] {
  const uniquePaths = new Set<string>();

  for (const path of paths) {
    const normalizedPath = normalizeVaultPath(path);
    if (!normalizedPath) continue;
    uniquePaths.add(normalizedPath);
  }

  return [...uniquePaths];
}

export function suppressVaultChangePath(
  path: string,
  options: SuppressVaultChangeOptions = {},
): string | null {
  cleanupExpiredSuppressions();

  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return null;

  const durationMs = Math.max(
    0,
    options.durationMs ?? DEFAULT_VAULT_CHANGE_SUPPRESSION_MS,
  );
  const expiresAt = now() + durationMs;
  const reason = options.reason ?? "app-initiated";

  const existingEntry = suppressionByPath.get(normalizedPath);

  suppressionByPath.set(normalizedPath, {
    reason,
    expiresAt: Math.max(existingEntry?.expiresAt ?? 0, expiresAt),
  });

  return normalizedPath;
}

export function suppressVaultChangePaths(
  paths: Iterable<string>,
  options: SuppressVaultChangeOptions = {},
): string[] {
  const normalizedPaths = getNormalizedUniquePaths(paths);

  for (const path of normalizedPaths) {
    suppressVaultChangePath(path, options);
  }

  return normalizedPaths;
}

export function isVaultChangePathSuppressed(path: string): boolean {
  cleanupExpiredSuppressions();

  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return false;

  const entry = suppressionByPath.get(normalizedPath);
  if (!entry) return false;

  if (entry.expiresAt <= now()) {
    suppressionByPath.delete(normalizedPath);
    return false;
  }

  return true;
}

export function partitionSuppressedVaultChangePaths(
  paths: Iterable<string>,
): PartitionedVaultChangePaths {
  cleanupExpiredSuppressions();

  const suppressedPaths: string[] = [];
  const unsuppressedPaths: string[] = [];

  for (const path of getNormalizedUniquePaths(paths)) {
    if (isVaultChangePathSuppressed(path)) {
      suppressedPaths.push(path);
    } else {
      unsuppressedPaths.push(path);
    }
  }

  return {
    suppressedPaths,
    unsuppressedPaths,
  };
}

export function clearVaultChangeSuppression(path: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return false;

  return suppressionByPath.delete(normalizedPath);
}

export function clearVaultChangeSuppressions(paths: Iterable<string>): number {
  let clearedCount = 0;

  for (const path of getNormalizedUniquePaths(paths)) {
    if (suppressionByPath.delete(path)) {
      clearedCount += 1;
    }
  }

  return clearedCount;
}

export function resetVaultChangeSuppressionRegistry(): void {
  suppressionByPath.clear();
}

export function getVaultChangeSuppressionSnapshot() {
  cleanupExpiredSuppressions();

  return [...suppressionByPath.entries()].map(([path, entry]) => ({
    path,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
  }));
}
