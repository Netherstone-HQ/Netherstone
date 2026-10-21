import { create } from "zustand";
import type { FileVersion } from "@/lib/history";

/** Where the history panel opens: beside the Editor, or beside Canvas. */
export type HistoryPlace = "notes" | "canvas";

interface HistoryState {
  /** Where the panel is open, or null while it's closed. */
  openIn: HistoryPlace | null;
  /**
   * A deleted shard whose history is open beside the Editor, in place of the
   * open shard's. Null for the open shard.
   */
  deletedPath: string | null;
  /** The version shown in place of the file, or null for the file as it is now. */
  picked: FileVersion | null;
  /** Whether the picked version shows what restoring it would change. */
  showChanges: boolean;
  /** Changes when a version is saved, so an open panel lists it. */
  versionsTick: number;
  /**
   * A rename or move under way, until the version saved after it: `to` is
   * null until the new path is known. An open panel keeps its list meanwhile.
   */
  pathChange: { from: string; to: string | null } | null;

  openHistory: (place: HistoryPlace) => void;
  openDeletedHistory: (path: string) => void;
  closeHistory: () => void;
  pickVersion: (version: FileVersion | null) => void;
  setShowChanges: (show: boolean) => void;
  versionsChanged: () => void;
  startPathChange: (from: string) => void;
  setPathChangeTarget: (to: string) => void;
  endPathChange: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  openIn: null,
  deletedPath: null,
  picked: null,
  showChanges: true,
  versionsTick: 0,
  pathChange: null,

  openHistory: (openIn) =>
    set((state) =>
      state.openIn === openIn && state.deletedPath === null
        ? {}
        : { openIn, deletedPath: null, picked: null },
    ),
  openDeletedHistory: (deletedPath) =>
    set({ openIn: "notes", deletedPath, picked: null }),
  closeHistory: () => set({ openIn: null, deletedPath: null, picked: null }),
  pickVersion: (picked) => set({ picked }),
  setShowChanges: (showChanges) => set({ showChanges }),
  versionsChanged: () =>
    set((state) => ({ versionsTick: state.versionsTick + 1 })),
  startPathChange: (from) => set({ pathChange: { from, to: null } }),
  setPathChangeTarget: (to) =>
    set((state) =>
      state.pathChange ? { pathChange: { ...state.pathChange, to } } : {},
    ),
  endPathChange: () => set({ pathChange: null }),
}));

/** The version on screen in `place`, if one is. */
export function useShownVersion(place: HistoryPlace) {
  return useHistoryStore((s) => (s.openIn === place ? s.picked : null));
}
