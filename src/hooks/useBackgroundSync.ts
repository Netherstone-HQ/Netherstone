import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { useGitHubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { useSyncStore } from "@/store/sync";
import { useVaultStore } from "@/store/vault";

/** First sync after a vault opens, once the app has settled. */
const STARTUP_DELAY_MS = 3_000;
/** Sync this long after the last edit. */
const AFTER_EDITS_DELAY_MS = 60_000;

/**
 * Keeps the open vault in sync while sync and automatic sync are on: shortly
 * after it opens, a minute after edits stop, on the interval chosen in
 * Settings (to pick up other devices' changes), and when the connection
 * comes back.
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
    const sync = () => void useSyncStore.getState().sync(path);

    let editTimer: number | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const startupTimer = window.setTimeout(sync, STARTUP_DELAY_MS);
    const interval = window.setInterval(sync, intervalMinutes * 60_000);
    window.addEventListener("online", sync);

    void listen("vault:changed", () => {
      window.clearTimeout(editTimer);
      editTimer = window.setTimeout(sync, AFTER_EDITS_DELAY_MS);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(editTimer);
      window.clearInterval(interval);
      window.removeEventListener("online", sync);
      unlisten?.();
    };
  }, [autoSync, enabled, intervalMinutes, signedIn, vaultPath]);
}
