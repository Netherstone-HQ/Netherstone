import { create } from "zustand";
import {
  filesInRow,
  listAttachments,
  type GalleryFile,
  type GalleryRow,
} from "@/lib/gallery";

interface GalleryState {
  /** The vault `files` came from. */
  vaultPath: string | null;
  files: GalleryFile[];
  status: "idle" | "loading" | "ready" | "error";
  /** Set when attachments or the index change, so the Gallery reloads. */
  isStale: boolean;
  /** Kept while you're in other modes. */
  selectedRow: GalleryRow;
  filter: string;
  /**
   * Loads the vault's attachments unless they're already current, keeping
   * the last list on screen meanwhile.
   */
  load: (vaultPath: string) => Promise<void>;
  invalidate: () => void;
  selectRow: (row: GalleryRow) => void;
  setFilter: (filter: string) => void;
}

let latestLoad = 0;

export const useGalleryStore = create<GalleryState>()((set, get) => ({
  vaultPath: null,
  files: [],
  status: "idle",
  isStale: true,
  selectedRow: "all",
  filter: "",
  load: async (vaultPath) => {
    const state = get();
    const isOtherVault = state.vaultPath !== vaultPath;
    if (!isOtherVault && !state.isStale) return;

    const request = ++latestLoad;
    // Cleared before the request, so a change while it runs marks it again.
    set(
      isOtherVault
        ? {
            vaultPath,
            files: [],
            status: "loading",
            isStale: false,
            selectedRow: "all",
            filter: "",
          }
        : { isStale: false },
    );

    try {
      const files = await listAttachments(vaultPath);
      if (request === latestLoad) set({ files, status: "ready" });
    } catch (error) {
      console.error("[Netherstone] Failed to load the Gallery:", error);
      if (request === latestLoad) set({ status: "error", isStale: true });
    }
  },
  invalidate: () => set({ isStale: true }),
  selectRow: (row) => set({ selectedRow: row }),
  setFilter: (filter) => set({ filter }),
}));

/** The selected row, or All files once it has no files left. */
export function selectActiveRow(state: GalleryState): GalleryRow {
  const { selectedRow, files } = state;
  return filesInRow(files, selectedRow).length > 0 ? selectedRow : "all";
}
