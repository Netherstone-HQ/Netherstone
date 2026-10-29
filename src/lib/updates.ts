import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
}

/** Whether this is the installed app, not `tauri dev` or a browser. */
export function isInstalledApp(): boolean {
  return isTauri() && !import.meta.env.DEV;
}

/**
 * Whether this build can update itself. Builds for package managers leave the
 * updater out, since the package manager updates them.
 */
export function canUpdate(): boolean {
  return __SELF_UPDATE__ && isInstalledApp();
}

/** Looks for a newer version on the stable or beta channel. */
export function checkForUpdate(beta: boolean): Promise<AvailableUpdate | null> {
  return invoke<AvailableUpdate | null>("updater_check", { beta });
}

/** Installs the update found by the last check and restarts the app. */
export function installUpdate(): Promise<void> {
  return invoke("updater_install");
}
