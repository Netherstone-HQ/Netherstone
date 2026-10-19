import { create } from "zustand";
import {
  getBrokenLinks,
  getWritingLog,
  type BrokenLink,
  type WritingLog,
} from "@/lib/data";

/** The Data page's sections, top to bottom, as the sidebar lists them. */
export const DATA_SECTIONS = [
  { id: "writing", label: "Writing" },
  { id: "broken-links", label: "Broken links" },
] as const;
export type DataSection = (typeof DATA_SECTIONS)[number]["id"];

interface DataState {
  /** The vault the figures came from. */
  vaultPath: string | null;
  log: WritingLog | null;
  brokenLinks: BrokenLink[];
  status: "idle" | "loading" | "ready" | "error";
  /** Bumped when the index changes, so an open Data page loads again. */
  version: number;
  /** The section in view, which the sidebar marks. */
  section: DataSection;
  /**
   * Loads the vault's writing and broken links, keeping the last figures on
   * screen meanwhile. Runs on every visit: saves don't mark it stale.
   */
  load: (vaultPath: string) => Promise<void>;
  invalidate: () => void;
  setSection: (section: DataSection) => void;
}

let latestLoad = 0;

export const useDataStore = create<DataState>()((set, get) => ({
  vaultPath: null,
  log: null,
  brokenLinks: [],
  status: "idle",
  version: 0,
  section: "writing",
  load: async (vaultPath) => {
    const request = ++latestLoad;
    if (get().vaultPath !== vaultPath) {
      set({ vaultPath, log: null, brokenLinks: [], status: "loading" });
    }

    try {
      const [log, brokenLinks] = await Promise.all([
        getWritingLog(vaultPath),
        getBrokenLinks(),
      ]);
      if (request === latestLoad) set({ log, brokenLinks, status: "ready" });
    } catch (error) {
      console.error("[Netherstone] Failed to load the Data page:", error);
      if (request === latestLoad) set({ status: "error" });
    }
  },
  invalidate: () => set((state) => ({ version: state.version + 1 })),
  setSection: (section) => set({ section }),
}));
