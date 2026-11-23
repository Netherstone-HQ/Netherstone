import { create } from "zustand";
import type { SettingsCategory } from "@/store/ui";

/** A full screen of the phone layout. */
export type PhoneScreen =
  | { kind: "home" }
  | { kind: "folder"; path: string }
  /** The open shard, or the open drawing when Canvas is the mode. */
  | { kind: "file" }
  | { kind: "search" }
  | { kind: "tags" }
  | { kind: "settings"; category: SettingsCategory | null }
  | { kind: "new-vault" };

/** A sheet or menu over the screen under it. */
export type PhoneOverlay =
  | { kind: "vault-menu" }
  | { kind: "more-menu"; folder: string | null }
  | { kind: "new-folder"; parent: string }
  | { kind: "new-shard"; folder: string }
  | { kind: "shard-menu" }
  | { kind: "assistant" }
  | { kind: "history" };

type Entry = PhoneScreen | PhoneOverlay;

const SCREEN_KINDS = new Set<string>([
  "home",
  "folder",
  "file",
  "search",
  "tags",
  "settings",
  "new-vault",
]);

function isScreen(entry: Entry): entry is PhoneScreen {
  return SCREEN_KINDS.has(entry.kind);
}

interface PhoneNavState {
  /** Everything opened since home, oldest first; one browser history entry each. */
  entries: Entry[];
  /** Opens `entry` on top, so Back returns to what's under it. */
  push: (entry: Entry) => void;
  /** Swaps the top entry for `entry`, so Back skips the one it replaces. */
  replace: (entry: Entry) => void;
  /** Goes back one step, as the system Back does. */
  back: () => void;
  /** Keeps the first `count` entries, after the browser went back. */
  truncate: (count: number) => void;
}

/** The key under which each history entry records its place in `entries`. */
const DEPTH_KEY = "phoneDepth";

function depthOf(state: unknown): number {
  const depth = (state as Record<string, unknown> | null)?.[DEPTH_KEY];
  return typeof depth === "number" ? depth : 0;
}

export const usePhoneNav = create<PhoneNavState>((set, get) => ({
  entries: [{ kind: "home" }],
  push: (entry) => {
    const entries = [...get().entries, entry];
    history.pushState({ [DEPTH_KEY]: entries.length - 1 }, "");
    set({ entries });
  },
  replace: (entry) => {
    const entries = [...get().entries.slice(0, -1), entry];
    set({ entries });
  },
  back: () => {
    if (get().entries.length > 1) history.back();
  },
  truncate: (count) =>
    set((state) =>
      count < state.entries.length
        ? { entries: state.entries.slice(0, Math.max(1, count)) }
        : state,
    ),
}));

/**
 * Follows the browser's history, so the system Back (Android) and the edge
 * swipe (iPhone) step back through the phone layout. Returns a cleanup.
 */
export function followBrowserHistory(): () => void {
  history.replaceState({ [DEPTH_KEY]: 0 }, "");
  const onPop = (event: PopStateEvent) =>
    usePhoneNav.getState().truncate(depthOf(event.state) + 1);
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}

/** The screen on show: the top entry that isn't a sheet or menu. */
export function usePhoneScreen(): PhoneScreen {
  return usePhoneNav((s) => {
    for (let at = s.entries.length - 1; at >= 0; at -= 1) {
      const entry = s.entries[at];
      if (isScreen(entry)) return entry;
    }
    return { kind: "home" };
  });
}

/** The sheet or menu open over the screen, if any. */
export function usePhoneOverlay(): PhoneOverlay | null {
  return usePhoneNav((s) => {
    const top = s.entries[s.entries.length - 1];
    return isScreen(top) ? null : top;
  });
}
