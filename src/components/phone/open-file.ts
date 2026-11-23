import { openVaultFile } from "@/lib/open-vault-file";
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
