import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { IS_ANDROID } from "@/lib/platform";
import { backInFront } from "@/lib/back-in-front";
import { androidBridge } from "@/lib/android-bridge";

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

/**
 * Downloads the update found by the last check, calling `onProgress` with
 * each whole percent when the size is known.
 */
export function downloadUpdate(
  onProgress: (percent: number) => void,
): Promise<void> {
  const channel = new Channel<number>(onProgress);
  return invoke("updater_download", { onProgress: channel });
}

/** The label of the button that installs a downloaded update. */
export const INSTALL_LABEL = IS_ANDROID ? "Install update" : "Restart to update";

/**
 * Installs the downloaded update and restarts. On Android the installer
 * takes it, after the "install apps" setting the first time.
 */
export async function installUpdate(): Promise<void> {
  await invoke("updater_install");
  const android = androidBridge();
  if (!android) return;
  if (android.installUpdate()) return;
  await backInFront();
  if (!android.installUpdate()) {
    throw new Error("Allow Netherstone to install apps, then try again.");
  }
}
