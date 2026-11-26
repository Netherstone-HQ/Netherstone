import { create } from "zustand";
import { isSamePath, pathKey } from "@/lib/drawing-files";

interface PhoneSelectionState {
  /** The shards picked in select mode. */
  paths: string[];
  /** Their path keys, so each row finds itself without a scan. */
  keys: Set<string>;
  toggle: (path: string) => void;
  set: (paths: string[]) => void;
}

const picked = (paths: string[]) => ({
  paths,
  keys: new Set(paths.map(pathKey)),
});

export const usePhoneSelection = create<PhoneSelectionState>((set) => ({
  ...picked([]),
  toggle: (path) =>
    set((state) =>
      picked(
        state.keys.has(pathKey(path))
          ? state.paths.filter((p) => !isSamePath(p, path))
          : [...state.paths, path],
      ),
    ),
  set: (paths) => set(picked(paths)),
}));
