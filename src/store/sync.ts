import { toast } from "sonner";
import { create } from "zustand";

import {
  getVaultFileDisplayName,
  resolveVaultRelativePath,
} from "@/lib/drawing-files";
import { errorMessage } from "@/lib/github-account";
import {
  type BackupSummary,
  type ConflictChoice,
  connectBackup,
  fileName,
  getVaultSyncRecord,
  isOfflineError,
  listBackups,
  planVaultSync,
  resolveConflict,
  type SyncConflict,
  type SyncPlanSummary,
  type SyncReport,
  syncNow,
  turnOffBackup,
  turnOnBackup,
  type VaultSyncRecord,
} from "@/lib/sync";
import { prepareForSync, showSyncedChanges } from "@/lib/sync-refresh";

interface SyncState {
  /** The vault the record and plan describe. */
  vaultPath: string | null;
  /** `null` until loaded, or when sync was never set up for the vault. */
  record: VaultSyncRecord | null;
  loaded: boolean;
  /** What sync would include; loaded by the panel while sync is off. */
  plan: SyncPlanSummary | null;
  isWorking: boolean;
  /** The last attempt couldn't reach GitHub. Cleared by the next success. */
  offline: boolean;
  error: string | null;
  /** The account's existing backups, loaded on demand. */
  backups: BackupSummary[] | null;
  /** The conflict shown in the "Choose which version to keep" dialog. */
  openConflict: SyncConflict | null;
  showConflict: (conflict: SyncConflict | null) => void;
  /** Reads the vault's sync state. Cheap, and never writes to the vault. */
  load: (vaultPath: string) => Promise<void>;
  loadPlan: (vaultPath: string) => Promise<void>;
  turnOn: (vaultPath: string) => Promise<boolean>;
  /**
   * Syncs now. Does nothing if a sync is already running. Resolves to
   * whether a sync ran and finished.
   */
  sync: (vaultPath: string) => Promise<boolean>;
  /**
   * Of `paths`, files changed on disk, the ones a sync didn't write: a sync
   * that brings in changes writes files, and those aren't edits to sync
   * back. Each file a sync wrote is matched once.
   */
  notWrittenBySync: (paths: string[]) => string[];
  turnOff: (vaultPath: string) => Promise<boolean>;
  loadBackups: () => Promise<void>;
  connect: (vaultPath: string, backup: BackupSummary) => Promise<boolean>;
  resolve: (vaultPath: string, path: string, choice: ConflictChoice) => Promise<void>;
}

/** A path as files on disk are compared: `/` separators, no trailing one. */
const pathKey = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

export const useSyncStore = create<SyncState>((set, get) => {
  const isCurrent = (vaultPath: string) => get().vaultPath === vaultPath;
  /** Files syncs wrote whose change on disk hasn't been seen yet. */
  const writtenBySync = new Set<string>();

  /** Runs `work` for `vaultPath`, dropping its result if the vault changed. */
  async function run(
    vaultPath: string,
    work: () => Promise<SyncReport | VaultSyncRecord>,
  ) {
    set({ isWorking: true, error: null });
    try {
      const result = await work();
      const report = "record" in result ? result : { record: result, changed: [] };
      for (const path of report.changed) {
        writtenBySync.add(pathKey(resolveVaultRelativePath(path, vaultPath)));
      }
      if (!isCurrent(vaultPath)) return false;
      const known = new Set(get().record?.conflicts.map((c) => c.path));
      set({ record: report.record, isWorking: false, offline: false });
      announceConflicts(report.record.conflicts.filter((c) => !known.has(c.path)));
      await showSyncedChanges(vaultPath, report.changed);
      if (!report.record.syncEnabled) await get().loadPlan(vaultPath);
      return true;
    } catch (e) {
      if (!isCurrent(vaultPath)) return false;
      const message = errorMessage(e);
      if (isOfflineError(message) && get().record?.syncEnabled) {
        set({ isWorking: false, offline: true });
      } else {
        set({ isWorking: false, error: message });
      }
      return false;
    }
  }

  /** Says when a sync found files changed on two devices. */
  function announceConflicts(conflicts: SyncConflict[]) {
    if (conflicts.length === 0) return;
    toast.warning(
      conflicts.length === 1
        ? `${getVaultFileDisplayName(fileName(conflicts[0].path))} changed on two devices`
        : `${conflicts.length} files changed on two devices`,
      {
        duration: 10_000,
        action: {
          label: "Review",
          onClick: () => get().showConflict(conflicts[0]),
        },
      },
    );
  }

  /** Saves pending edits first, so the sync includes them. */
  async function runSync(vaultPath: string, work: () => Promise<SyncReport>) {
    if (get().isWorking) return false;
    if (!(await prepareForSync())) return false;
    return run(vaultPath, work);
  }

  return {
    vaultPath: null,
    record: null,
    loaded: false,
    plan: null,
    isWorking: false,
    offline: false,
    error: null,
    backups: null,
    openConflict: null,
    showConflict: (openConflict) => set({ openConflict }),
    notWrittenBySync: (paths) =>
      paths.filter((path) => !writtenBySync.delete(pathKey(path))),

    load: async (vaultPath) => {
      if (!isCurrent(vaultPath)) {
        set({
          vaultPath,
          record: null,
          loaded: false,
          plan: null,
          isWorking: false,
          offline: false,
          error: null,
          openConflict: null,
        });
      }
      try {
        const record = await getVaultSyncRecord(vaultPath);
        if (isCurrent(vaultPath)) set({ record, loaded: true });
      } catch (e) {
        if (isCurrent(vaultPath)) set({ loaded: true, error: errorMessage(e) });
      }
    },

    loadPlan: async (vaultPath) => {
      try {
        const plan = await planVaultSync(vaultPath);
        if (isCurrent(vaultPath)) set({ plan });
      } catch (e) {
        if (isCurrent(vaultPath)) set({ error: errorMessage(e) });
      }
    },

    turnOn: (vaultPath) => runSync(vaultPath, () => turnOnBackup(vaultPath)),
    sync: (vaultPath) => runSync(vaultPath, () => syncNow(vaultPath)),
    turnOff: (vaultPath) => run(vaultPath, () => turnOffBackup(vaultPath)),

    loadBackups: async () => {
      set({ backups: null, error: null });
      try {
        set({ backups: await listBackups() });
      } catch (e) {
        set({ backups: [], error: errorMessage(e) });
      }
    },

    connect: (vaultPath, backup) =>
      runSync(vaultPath, () => connectBackup(vaultPath, backup)),

    resolve: async (vaultPath, path, choice) => {
      if (!(await prepareForSync())) return;
      try {
        const record = await resolveConflict(vaultPath, path, choice);
        if (!isCurrent(vaultPath)) return;
        set({ record });
        await showSyncedChanges(vaultPath, choice === "thisDevice" ? [] : [path]);
      } catch (e) {
        if (isCurrent(vaultPath)) set({ error: errorMessage(e) });
        return;
      }
      // Uploads the decision.
      await get().sync(vaultPath);
    },
  };
});
