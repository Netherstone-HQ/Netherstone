import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { saveVaultVersion } from "@/lib/sync";
import { useVaultStore } from "@/store/vault";

/** A version is saved this long after changes stop. */
export const VERSION_DELAY_MS = 60_000;
/** While changes keep coming, a version is saved at least this often. */
export const VERSION_CAP_MS = 10 * 60_000;

/**
 * Keeps the open vault's local history, with or without sync: saves a
 * version a minute after changes stop, every ten minutes while they don't,
 * and a minute after the vault opens (for changes made while the app was
 * closed). Leaving a vault saves its pending version right away.
 */
export function useLocalHistory() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);

  useEffect(() => {
    if (!vaultPath) return;
    const path = vaultPath;
    // When the oldest change not yet in a version was made.
    let pendingSince: number | undefined;
    const save = () => {
      timer = undefined;
      pendingSince = undefined;
      saveVaultVersion(path).catch((error) =>
        console.error("[Netherstone] Couldn't save a version:", error),
      );
    };

    let timer: number | undefined = window.setTimeout(save, VERSION_DELAY_MS);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen("vault:changed", () => {
      const now = Date.now();
      pendingSince ??= now;
      window.clearTimeout(timer);
      const untilCap = pendingSince + VERSION_CAP_MS - now;
      timer = window.setTimeout(save, Math.min(VERSION_DELAY_MS, untilCap));
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      if (timer !== undefined) {
        window.clearTimeout(timer);
        save();
      }
    };
  }, [vaultPath]);
}
