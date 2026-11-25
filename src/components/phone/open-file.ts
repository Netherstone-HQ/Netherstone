import { openFileHistory, openVaultFile } from "@/lib/open-vault-file";
import { useEditorStore, type PendingReveal } from "@/store/editor";
import { usePhoneNav } from "./nav";

/**
 * Opens a shard or drawing on its own screen. With `replace`, the screen
 * takes the place of the sheet it was made from.
 */
export async function openFileScreen(path: string, replace = false) {
  await openVaultFile(path);
  const nav = usePhoneNav.getState();
  if (replace) nav.replace({ kind: "file", path });
  else nav.push({ kind: "file", path });
}

/** Opens a shard on its own screen, scrolled to what `reveal` names. */
export async function openFileScreenAt(reveal: PendingReveal) {
  const { setPendingLinkReveal } = useEditorStore.getState();
  setPendingLinkReveal(reveal);
  try {
    await openFileScreen(reveal.path);
  } catch (error) {
    setPendingLinkReveal(null);
    throw error;
  }
}

/**
 * Shows the history of `path`. With `replace`, it takes the place of the
 * sheet it was opened from.
 */
export function openHistoryScreen(path: string, replace = false) {
  const nav = usePhoneNav.getState();
  if (replace) nav.replace({ kind: "history" });
  else nav.push({ kind: "history" });
  void openFileHistory(path).catch((error: unknown) =>
    console.error("[Netherstone] Couldn't show history:", error),
  );
}
