/**
 * Importing files as shards: the menus open the import window
 * (ImportDialog) on a vault folder. This is all the menus load; the engine
 * and its formats load when the window first opens.
 */

import { create } from "zustand";

interface ImportDialogState {
  /** The folder the shards go in, or null when the window is closed. */
  targetDir: string | null;
  open: (targetDir: string) => void;
  close: () => void;
}

export const useImportDialogStore = create<ImportDialogState>((set) => ({
  targetDir: null,
  open: (targetDir) => set({ targetDir }),
  close: () => set({ targetDir: null }),
}));

/** Opens the import window for a folder in the vault. */
export function openImportDialog(targetDir: string) {
  useImportDialogStore.getState().open(targetDir);
}
