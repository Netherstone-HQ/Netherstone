import { toast } from "sonner";
import { IS_ANDROID } from "@/lib/platform";
import { backInFront } from "@/lib/back-in-front";

/** Sent by MainActivity.kt when the folder picker closes, saying how. */
const FOLDER_PICKED_EVENT = "folderpicked";

type FolderPick = "picked" | "cancelled" | "unusable";

/**
 * On Android, lets the person pick a folder in the phone's storage for a
 * vault, first asking for the access a vault there needs ("All files
 * access"). Resolves with whether a folder was picked; Rust then takes it
 * (`open_vault_dialog`), so the page never names the folder itself.
 * Elsewhere there's nothing to do first: true.
 */
export async function pickSharedFolder(): Promise<boolean> {
  const android = IS_ANDROID ? window.NetherstoneAndroid : undefined;
  if (!android) return true;
  if (!android.hasAllFilesAccess()) {
    android.askAllFilesAccess();
    await backInFront();
    if (!android.hasAllFilesAccess()) {
      toast("Netherstone needs access to your files to keep a vault there", {
        action: { label: "Allow", onClick: () => android.askAllFilesAccess() },
      });
      return false;
    }
  }
  const outcome = new Promise<FolderPick>((resolve) =>
    window.addEventListener(
      FOLDER_PICKED_EVENT,
      (event) => resolve((event as CustomEvent<FolderPick>).detail),
      { once: true },
    ),
  );
  android.pickFolder();
  const picked = await outcome;
  if (picked !== "unusable") return picked === "picked";
  toast.error("Pick a folder in this phone's storage", {
    description: "Folders in other apps, such as cloud drives, can't hold a vault.",
  });
  return false;
}
