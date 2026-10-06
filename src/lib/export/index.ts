/**
 * Shard export: the menus open the export window (ExportDialog), where the
 * format and options are picked with a live preview. This is all the menus
 * load; the window and everything it uses load when it first opens.
 */

import { create } from "zustand";

import { getVaultFileDisplayName } from "@/lib/drawing-files";

export type { ExportFormat } from "./model";

interface ExportDialogState {
  /** The shard being exported, or null when the window is closed. */
  filePath: string | null;
  open: (filePath: string) => void;
  close: () => void;
}

export const useExportDialogStore = create<ExportDialogState>((set) => ({
  filePath: null,
  open: (filePath) => set({ filePath }),
  close: () => set({ filePath: null }),
}));

/** Opens the export window for a shard. */
export function openExportDialog(filePath: string) {
  useExportDialogStore.getState().open(filePath);
}

export function shardNameOf(filePath: string) {
  return getVaultFileDisplayName(filePath.split(/[\\/]/).pop() ?? filePath);
}
