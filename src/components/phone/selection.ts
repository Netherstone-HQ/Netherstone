import { create } from "zustand";
import { isSamePath } from "@/lib/drawing-files";

interface PhoneSelectionState {
  /** The shards picked in select mode. */
  paths: string[];
  toggle: (path: string) => void;
  set: (paths: string[]) => void;
}

export const usePhoneSelection = create<PhoneSelectionState>((set) => ({
  paths: [],
  toggle: (path) =>
    set((state) => ({
      paths: state.paths.some((p) => isSamePath(p, path))
        ? state.paths.filter((p) => !isSamePath(p, path))
        : [...state.paths, path],
    })),
  set: (paths) => set({ paths }),
}));
