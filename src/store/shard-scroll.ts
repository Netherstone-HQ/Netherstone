import { create } from "zustand";
import { persist } from "zustand/middleware";

import { isPathWithin, remapPathAfterMove } from "@/lib/drawing-files";

/** Shards whose place is remembered; the least recently read go first. */
const MAX_REMEMBERED_SHARDS = 500;

/**
 * Where a shard was scrolled to: the top-level block at the top of the
 * window, and how far past that block's top. A block, not a pixel offset,
 * because the editor lays out long shards gradually, so pixel offsets only
 * settle once everything above has been drawn.
 */
export interface ShardScrollPosition {
  block: number;
  offset: number;
}

interface RememberedPosition extends ShardScrollPosition {
  /** When it was saved, to forget the oldest first. */
  at: number;
}

interface ShardScrollState {
  positions: Record<string, RememberedPosition>;
  getPosition: (path: string) => ShardScrollPosition | null;
  setPosition: (path: string, position: ShardScrollPosition) => void;
  /** Renaming or moving a folder also moves the places of the shards in it. */
  remapPositions: (previousPath: string, nextPath: string) => void;
  /** Removing a folder also forgets the shards inside it. */
  forgetPositions: (path: string) => void;
}

/** Paths reach the app with either separator. */
function keyOf(path: string) {
  return path.replace(/\\/g, "/");
}

function withoutOldest(positions: Record<string, RememberedPosition>) {
  const entries = Object.entries(positions);
  if (entries.length <= MAX_REMEMBERED_SHARDS) return positions;

  entries.sort(([, a], [, b]) => b.at - a.at);
  return Object.fromEntries(entries.slice(0, MAX_REMEMBERED_SHARDS));
}

/** Kept in app data (the webview's storage), never in the vault. */
export const useShardScrollStore = create<ShardScrollState>()(
  persist(
    (set, get) => ({
      positions: {},
      getPosition: (path) => {
        const position = get().positions[keyOf(path)];
        return position
          ? { block: position.block, offset: position.offset }
          : null;
      },
      setPosition: (path, { block, offset }) =>
        set((state) => ({
          positions: withoutOldest({
            ...state.positions,
            [keyOf(path)]: { block, offset, at: Date.now() },
          }),
        })),
      remapPositions: (previousPath, nextPath) =>
        set((state) => ({
          positions: Object.fromEntries(
            Object.entries(state.positions).map(([path, position]) => [
              keyOf(remapPathAfterMove(path, previousPath, nextPath) ?? path),
              position,
            ]),
          ),
        })),
      forgetPositions: (path) =>
        set((state) => ({
          positions: Object.fromEntries(
            Object.entries(state.positions).filter(
              ([entryPath]) => !isPathWithin(entryPath, path),
            ),
          ),
        })),
    }),
    {
      name: "netherstone-shard-scroll",
      version: 0,
      partialize: (state) => ({ positions: state.positions }),
    },
  ),
);
