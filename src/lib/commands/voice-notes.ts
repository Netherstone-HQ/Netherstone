import { invoke } from "@tauri-apps/api/core";
import { androidBridge } from "@/lib/android-bridge";
import type { PersistedAttachment } from "./attachments";
import { bytesBody } from "./bytes";
import { assertTauri } from "./tauri";

/** Why a recording couldn't be written or saved. */
export type VoiceNoteWriteError =
  | { kind: "diskFull" }
  | { kind: "failed"; message: string };

export function isVoiceNoteWriteError(
  error: unknown,
): error is VoiceNoteWriteError {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { kind?: unknown }).kind === "diskFull" ||
      (error as { kind?: unknown }).kind === "failed")
  );
}

/** Starts a temporary file for a new recording. */
export async function beginVoiceNote(): Promise<{ syncLimitBytes: number }> {
  assertTauri();
  return invoke("voice_note_begin");
}

/** Adds bytes to the recording's temporary file. */
export async function appendVoiceNote(bytes: Uint8Array): Promise<void> {
  assertTauri();
  await invoke("voice_note_append", bytesBody(bytes));
}

/**
 * Stores the recording in `vaultPath` as `fileName`, with its first
 * `replaces` bytes swapped for `head`.
 */
export async function saveVoiceNote(
  vaultPath: string,
  fileName: string,
  head: Uint8Array,
  replaces: number,
): Promise<PersistedAttachment> {
  assertTauri();
  return invoke<PersistedAttachment>("voice_note_save", bytesBody(head), {
    headers: {
      "x-file-name": encodeURIComponent(fileName),
      "x-vault-path": encodeURIComponent(vaultPath),
      "x-head-replaces": String(replaces),
    },
  });
}

/** Drops the recording and its temporary file. */
export async function discardVoiceNote(): Promise<void> {
  assertTauri();
  await invoke("voice_note_discard");
}

/** Whether this system has a page to turn microphone access on. */
export async function microphoneSettingsAvailable(): Promise<boolean> {
  // On Android, the app's own settings page, where its permissions are.
  if (androidBridge()) return true;
  assertTauri();
  return invoke<boolean>("microphone_settings_available");
}

/** Opens the system's microphone privacy page. */
export async function openMicrophoneSettings(): Promise<void> {
  const android = androidBridge();
  if (android) return android.openAppSettings();
  assertTauri();
  await invoke("open_microphone_settings");
}
