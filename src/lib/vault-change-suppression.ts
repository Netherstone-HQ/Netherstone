
type PartitionedVaultChangePaths = {
  suppressedPaths: string[];
  unsuppressedPaths: string[];
};

const VAULT_CHANGE_SUPPRESSION_MS = 2_500;

/** When each suppressed path stops being suppressed. */
const suppressionByPath = new Map<string, number>();

function now(): number {
  return window.performance.now();
}

function normalizeVaultPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\\/g, "/");
}

function cleanupExpiredSuppressions(currentTime = now()): void {
  for (const [path, expiresAt] of suppressionByPath.entries()) {
    if (expiresAt <= currentTime) {
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

export function suppressVaultChangePath(path: string): string | null {
  cleanupExpiredSuppressions();

  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return null;

  const expiresAt = now() + VAULT_CHANGE_SUPPRESSION_MS;
  suppressionByPath.set(
    normalizedPath,
    Math.max(suppressionByPath.get(normalizedPath) ?? 0, expiresAt),
  );

  return normalizedPath;
}

export function suppressVaultChangePaths(paths: Iterable<string>): string[] {
  const normalizedPaths = getNormalizedUniquePaths(paths);

  for (const path of normalizedPaths) {
    suppressVaultChangePath(path);
  }

  return normalizedPaths;
}

function isVaultChangePathSuppressed(path: string): boolean {
  cleanupExpiredSuppressions();

  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return false;

  const expiresAt = suppressionByPath.get(normalizedPath);
  if (expiresAt === undefined) return false;

  if (expiresAt <= now()) {
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
