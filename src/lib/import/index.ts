/**
 * Importing files as shards: the menus open the import window
 * (ImportDialog) on a vault folder. This is all the menus load; the engine
 * and its formats load when the window first opens.
 *
 * An import keeps running when the window is closed, so the person can go
 * on working; a toast shows how far it got and opens the window again.
 */

import { create } from "zustand";

import type { ImportProgress, ImportReport } from "./engine";

export type ImportStep =
  | { kind: "importing"; progress: ImportProgress | null }
  /** `since`: when the import started, in unix seconds, for Undo. */
  | { kind: "done"; report: ImportReport; vaultPath: string; since: number; isUndoing?: boolean };

/** An import started from the window, until its summary is closed. */
export interface ImportJob {
  targetDir: string;
  step: ImportStep;
  cancel: () => void;
}

interface ImportDialogState {
  /** The folder the shards go in, or null when the window is closed. */
  targetDir: string | null;
  job: ImportJob | null;
  open: (targetDir: string) => void;
  close: () => void;
  setJob: (job: ImportJob | null) => void;
}

export const useImportDialogStore = create<ImportDialogState>((set, get) => ({
  targetDir: null,
  job: null,
  // Only one import runs at a time: while one does, the window shows it.
  open: (targetDir) => set({ targetDir: get().job?.targetDir ?? targetDir }),
  close: () => {
    // Closing the summary is done with the import; closing the window while
    // it runs only hides it.
    if (get().job?.step.kind === "done") set({ job: null });
    set({ targetDir: null });
  },
  setJob: (job) => set({ job }),
}));

/** Opens the import window for a folder in the vault. */
export function openImportDialog(targetDir: string) {
  useImportDialogStore.getState().open(targetDir);
}
