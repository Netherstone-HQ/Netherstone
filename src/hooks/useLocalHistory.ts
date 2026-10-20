import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { saveVaultVersion } from "@/lib/sync";
import { useVaultStore } from "@/store/vault";

/** A version is saved this long after changes stop. */
export const VERSION_DELAY_MS = 60_000;

/**
 * Keeps the open vault's local history, with or without sync: saves a
 * version a minute after changes stop, and a minute after the vault opens
 * (for changes made while the app was closed). Leaving a vault saves its
 * pending version right away.
 */
export function useLocalHistory() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);

  useEffect(() => {
    if (!vaultPath) return;
    const path = vaultPath;
    const save = () => {
      timer = undefined;
      saveVaultVersion(path).catch((error) =>
        console.error("[Netherstone] Couldn't save a version:", error),
      );
    };

    let timer: number | undefined = window.setTimeout(save, VERSION_DELAY_MS);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen("vault:changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, VERSION_DELAY_MS);
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
