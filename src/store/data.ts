import { create } from "zustand";
import {
  getBrokenLinks,
  getChartShards,
  getWritingLog,
  type BrokenLink,
  type ChartShard,
  type WritingLog,
} from "@/lib/data";

/** The Overview page's sections, top to bottom, as the sidebar lists them. */
export const DATA_SECTIONS = [
  { id: "writing", label: "Writing" },
  { id: "charts", label: "Charts" },
  { id: "health", label: "Health" },
] as const;
export type DataSection = (typeof DATA_SECTIONS)[number]["id"];

interface DataState {
  /** The vault the figures came from. */
  vaultPath: string | null;
  log: WritingLog | null;
  brokenLinks: BrokenLink[];
  /** The shards with charts. */
  chartShards: ChartShard[];
  status: "idle" | "loading" | "ready" | "error";
  /** Bumped when the index changes, so an open Overview page loads again. */
  version: number;
  /** The section in view, which the sidebar marks. */
  section: DataSection;
  /** A section to scroll to once the page has loaded. */
  pendingSection: DataSection | null;
  /**
   * Loads the vault's writing, charts and broken links, keeping the last figures on
   * screen meanwhile. Runs on every visit: saves don't mark it stale.
   */
  load: (vaultPath: string) => Promise<void>;
  invalidate: () => void;
  setSection: (section: DataSection) => void;
  scrollToOnOpen: (section: DataSection | null) => void;
}

let latestLoad = 0;

export const useDataStore = create<DataState>()((set, get) => ({
  vaultPath: null,
  log: null,
  brokenLinks: [],
  chartShards: [],
  status: "idle",
  version: 0,
  section: "writing",
  pendingSection: null,
  load: async (vaultPath) => {
    const request = ++latestLoad;
    if (get().vaultPath !== vaultPath) {
      set({
        vaultPath,
        log: null,
        brokenLinks: [],
        chartShards: [],
        status: "loading",
      });
    }

    try {
      const [log, brokenLinks, chartShards] = await Promise.all([
        getWritingLog(vaultPath),
        getBrokenLinks(),
        getChartShards(),
      ]);
      if (request === latestLoad) {
        set({ log, brokenLinks, chartShards, status: "ready" });
      }
    } catch (error) {
      console.error("[Netherstone] Failed to load the Overview page:", error);
      if (request === latestLoad) set({ status: "error" });
    }
  },
  invalidate: () => set((state) => ({ version: state.version + 1 })),
  setSection: (section) => set({ section }),
  scrollToOnOpen: (pendingSection) => set({ pendingSection }),
}));
