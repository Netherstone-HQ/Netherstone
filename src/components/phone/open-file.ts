import { openVaultFile } from "@/lib/open-vault-file";
import { useEditorStore, type PendingReveal } from "@/store/editor";
import { usePhoneNav } from "./nav";

/**
 * Opens a shard or drawing on its own screen. With `replace`, the screen
 * takes the place of the sheet it was made from.
 */
export async function openFileScreen(path: string, replace = false) {
  await openVaultFile(path);
  const nav = usePhoneNav.getState();
  if (replace) nav.replace({ kind: "file" });
  else nav.push({ kind: "file" });
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
