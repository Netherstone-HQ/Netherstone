import { invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

/** What was opened from outside the app and not yet taken. */
export interface Launched {
  /** A folder to open as the vault. */
  vault: string | null;
  /** Files to import, which Rust now lets the import read. */
  files: string[];
  /** Names of files that wait until they can be imported. */
  waiting: string[];
  /** The address of a Netherstone link to open, which Rust now lets the window open. */
  link: string | null;
}

/**
 * Takes the folders, files and links opened from outside the app (the
 * terminal, Open with, the Dock, a Netherstone link). Files stay in Rust
 * until `canImport`, a link until `canOpenLink`.
 */
export async function takeLaunch(canImport: boolean, canOpenLink: boolean): Promise<Launched> {
  assertTauri();
  return invoke<Launched>("take_launch", { canImport, canOpenLink });
}
