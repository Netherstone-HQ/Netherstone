import { create } from "zustand";
import {
  getBrokenLinks,
  getCharts,
  getWritingLog,
  type BrokenLink,
  type ShardChart,
  type WritingLog,
} from "@/lib/data";

interface DataState {
  /** The vault the figures came from. */
  vaultPath: string | null;
  log: WritingLog | null;
  brokenLinks: BrokenLink[];
  charts: ShardChart[];
  status: "idle" | "loading" | "ready" | "error";
  /** Bumped when the index changes, so an open Overview page loads again. */
  version: number;
  /**
   * Loads the vault's writing, charts and broken links, keeping the last figures on
   * screen meanwhile. Runs on every visit: saves don't mark it stale.
   */
  load: (vaultPath: string) => Promise<void>;
  invalidate: () => void;
}

let latestLoad = 0;

export const useDataStore = create<DataState>()((set, get) => ({
  vaultPath: null,
  log: null,
  brokenLinks: [],
  charts: [],
  status: "idle",
  version: 0,
  load: async (vaultPath) => {
    const request = ++latestLoad;
    if (get().vaultPath !== vaultPath) {
      set({
        vaultPath,
        log: null,
        brokenLinks: [],
        charts: [],
        status: "loading",
      });
    }

    try {
      const [log, brokenLinks, charts] = await Promise.all([
        getWritingLog(vaultPath),
        getBrokenLinks(),
        getCharts(),
      ]);
      if (request === latestLoad) {
        set({ log, brokenLinks, charts, status: "ready" });
      }
    } catch (error) {
      console.error("[Netherstone] Failed to load the Overview page:", error);
      if (request === latestLoad) set({ status: "error" });
    }
  },
  invalidate: () => set((state) => ({ version: state.version + 1 })),
}));
