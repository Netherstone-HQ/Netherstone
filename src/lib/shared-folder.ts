import { toast } from "sonner";
import { androidBridge } from "@/lib/android-bridge";
import { backInFront } from "@/lib/back-in-front";

/** Sent by MainActivity.kt when the folder picker closes, saying how. */
const FOLDER_PICKED_EVENT = "folderpicked";

type FolderPick = "picked" | "cancelled" | "unusable";

/**
 * On Android, asks for "All files access" and picks a folder for a vault.
 * Resolves with whether one was picked; Rust takes it, so the page never
 * names it. Elsewhere, true.
 */
export async function pickSharedFolder(): Promise<boolean> {
  const android = androidBridge();
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
