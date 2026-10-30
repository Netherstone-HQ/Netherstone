import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { takeLaunch } from "@/lib/commands";
import { isImporting, openImportDialog, useImportDialogStore } from "@/lib/import";
import { DRAWING_EXTENSION, isPathWithin } from "@/lib/drawing-files";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { isOpeningLink, openLink, useOpenLink } from "@/lib/open-link";
import { folderName, openVault } from "@/lib/open-vault";
import { openVaultFile } from "@/lib/open-vault-file";
import { useVaultStore } from "@/store";

/** Sent by Rust (launch.rs) when something is opened from outside the app. */
const LAUNCH_EVENT = "launch";
const WAITING_TOAST_ID = "launch-waiting";

/**
 * Opens what came in from outside the app: the terminal (`netherstone .`),
 * Open with, a folder's right-click menu, the Dock, a Netherstone link. A
 * folder opens as the vault, files open in the import window, a link opens
 * its dialog. Files wait while no vault is open or another import runs, and
 * go in once that's over; a link waits while an import or another link runs.
 *
 * Rust holds the paths; this only asks for them, so the window never says
 * which files may be read.
 */
export function useLaunches() {
  useEffect(() => {
    const take = () => void openLaunched();
    const unlisten = listen(LAUNCH_EVENT, take);
    const stopVault = useVaultStore.subscribe((state, previous) => {
      if (state.currentVaultPath !== previous.currentVaultPath) take();
    });
    const stopImport = useImportDialogStore.subscribe((state, previous) => {
      if (previous.job?.step.kind === "importing" && state.job?.step.kind !== "importing") take();
    });
    const stopLink = useOpenLink.subscribe((state, previous) => {
      if (previous.step && !state.step) take();
    });
    take();
    return () => {
      void unlisten.then((stop) => stop());
      stopVault();
      stopImport();
      stopLink();
    };
  }, []);
}

// One take at a time, so a vault opening mid-take is seen by the next one.
let taking = Promise.resolve();

/** Opens what came in and wasn't taken yet. */
export function openLaunched() {
  taking = taking.then(takeOnce).catch((error) =>
    console.error("[Netherstone] Couldn't open what was opened from outside:", error),
  );
  return taking;
}

async function takeOnce() {
  const canImport = () => !!useVaultStore.getState().currentVaultPath && !isImporting();
  const { vault, files, waiting, link } = await takeLaunch(canImport(), !isImporting() && !isOpeningLink());
  if (link) void openLink(link);

  if (vault && vault !== useVaultStore.getState().currentVaultPath) {
    const chosen = await chooseVaultFolder(vault, "open");
    if (chosen) {
      await openVault(chosen).catch((error) => {
        console.error("[Netherstone] Failed to open vault:", error);
        toast.error(`Couldn't open ${folderName(chosen)}`);
      });
    }
  }

  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (files.length && vaultPath) {
    toast.dismiss(WAITING_TOAST_ID);
    // A shard or drawing already in the vault opens; importing it would copy it.
    const inVault = files.filter((path) => isPathWithin(path, vaultPath) && isVaultFile(path));
    const outside = files.filter((path) => !inVault.includes(path));
    const last = inVault.at(-1);
    if (last) await openVaultFile(last);
    if (outside.length) openImportDialog(vaultPath, outside);
  } else if (waiting.length && !vaultPath) {
    toast(`Open or create a vault to import ${waitingText(waiting)}`, {
      id: WAITING_TOAST_ID,
      duration: Infinity,
    });
  }
}

/** A file the vault opens itself: a shard or a drawing. */
function isVaultFile(path: string) {
  const name = path.toLowerCase();
  return name.endsWith(".md") || name.endsWith(DRAWING_EXTENSION);
}

/** `Report.md`, `Report.md and Plan.docx`, or `3 files`. */
export function waitingText(names: string[]) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} files`;
}
