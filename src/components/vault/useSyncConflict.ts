import { isPathWithin, resolveVaultRelativePath } from "@/lib/drawing-files";
import type { SyncConflict } from "@/lib/sync";
import { useSyncStore } from "@/store/sync";

/** Conflicts waiting for a decision whose files are at or inside `path`. */
function conflictsWithin(
  state: ReturnType<typeof useSyncStore.getState>,
  path: string,
): SyncConflict[] {
  const { vaultPath, record } = state;
  if (!vaultPath || !record) return [];
  return record.conflicts.filter((conflict) =>
    isPathWithin(resolveVaultRelativePath(conflict.path, vaultPath), path),
  );
}

/** The sync conflict on the file at `path`, if it has one. */
export function useFileConflict(path: string): SyncConflict | null {
  return useSyncStore((s) => conflictsWithin(s, path)[0] ?? null);
}

/** True when a file inside the folder at `path` has a sync conflict. */
export function useFolderHasConflict(path: string): boolean {
  return useSyncStore((s) => conflictsWithin(s, path).length > 0);
}
