import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { hasPendingDrawingSave } from "@/lib/drawing-files";
import { setSyncBeforeQuit } from "@/lib/sync-before-quit";
import { useEditorStore } from "@/store/editor";
import { useGitHubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { useSyncStore } from "@/store/sync";
import { useVaultStore } from "@/store/vault";

/** First sync after a vault opens, once the app has settled. */
const STARTUP_DELAY_MS = 3_000;

/**
 * Keeps the open vault in sync while sync and automatic sync are on. It
 * syncs once the vault opens, then when you leave the window with edits,
 * when you come back to it, while edits wait, and when the connection comes
 * back, but at most once per interval chosen in Settings: a sync asked for
 * sooner waits for the interval to end. Quitting with edits syncs right away.
 */
export function useBackgroundSync() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const signedIn = useGitHubStore((s) => s.account !== null);
  const enabled = useSyncStore(
    (s) => s.vaultPath === vaultPath && (s.record?.syncEnabled ?? false),
  );
  const autoSync = useSettingsStore((s) => s.autoSync);
  const intervalMinutes = useSettingsStore((s) => s.autoSyncInterval);
  const loadAccount = useGitHubStore((s) => s.load);
  const accountLoaded = useGitHubStore((s) => s.loaded);

  useEffect(() => {
    if (!accountLoaded) void loadAccount();
  }, [accountLoaded, loadAccount]);

  useEffect(() => {
    if (!vaultPath || !enabled || !signedIn || !autoSync) return;
    const path = vaultPath;
    const intervalMs = intervalMinutes * 60_000;

    // When the oldest change not yet synced was made.
    let pendingSince: number | undefined;
    // The earliest a sync was asked for, while it waits on the interval.
    let dueAt: number | undefined;
    let timer: number | undefined;

    const hasUnsyncedEdits = () =>
      pendingSince !== undefined ||
      useEditorStore.getState().isDirty ||
      hasPendingDrawingSave();

    const sync = async () => {
      window.clearTimeout(timer);
      timer = undefined;
      dueAt = undefined;
      const since = pendingSince;
      pendingSince = undefined;
      const synced = await useSyncStore.getState().sync(path);
      // Edits a sync didn't take still wait, for quitting and the next try.
      if (!synced && since !== undefined) {
        pendingSince = Math.min(pendingSince ?? since, since);
      }
    };

    /** Syncs at `at`, or when the interval since the last sync ends. */
    const syncBy = (at: number) => {
      dueAt = Math.min(dueAt ?? at, at);
      const lastSyncSeconds = useSyncStore.getState().record?.lastSyncAt;
      const allowedAt =
        lastSyncSeconds == null ? 0 : lastSyncSeconds * 1000 + intervalMs;
      const wait = Math.max(dueAt, allowedAt) - Date.now();
      window.clearTimeout(timer);
      if (wait <= 0) void sync();
      else timer = window.setTimeout(() => syncBy(dueAt ?? Date.now()), wait);
    };

    const startupTimer = window.setTimeout(() => void sync(), STARTUP_DELAY_MS);
    const comeBack = () => syncBy(Date.now());
    window.addEventListener("online", comeBack);

    let unlistenChanges: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let cancelled = false;

    void listen<{ paths?: string[] }>("vault:changed", ({ payload }) => {
      // No paths asks for a rescan, which may hold edits.
      const paths = payload?.paths ?? [];
      if (paths.length && !useSyncStore.getState().notWrittenBySync(paths).length) return;
      pendingSince ??= Date.now();
      syncBy(pendingSince + intervalMs);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenChanges = fn;
    });

    // Leaving with edits pushes them; coming back picks up other devices'.
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused || hasUnsyncedEdits()) syncBy(Date.now());
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenFocus = fn;
      });

    const clearSyncBeforeQuit = setSyncBeforeQuit(() =>
      hasUnsyncedEdits() ? sync : null,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(timer);
      window.removeEventListener("online", comeBack);
      unlistenChanges?.();
      unlistenFocus?.();
      clearSyncBeforeQuit();
    };
  }, [autoSync, enabled, intervalMinutes, signedIn, vaultPath]);
}
