import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** Whether this build can update itself: the installed app, not `tauri dev`. */
export function canUpdate(): boolean {
  return isTauri() && !import.meta.env.DEV;
}

/** Looks for a newer version on the stable or beta channel. */
export function checkForUpdate(beta: boolean): Promise<AvailableUpdate | null> {
  return invoke<AvailableUpdate | null>("updater_check", { beta });
}

/** Installs the update found by the last check and restarts the app. */
export function installUpdate(): Promise<void> {
  return invoke("updater_install");
}
