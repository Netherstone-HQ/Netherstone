import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { useState } from "react";
import { create } from "zustand";
import type { SettingsCategory } from "@/store/ui";

/** What Search shows only. */
export type SearchFilter =
  | { kind: "drawings" }
  | { kind: "images" }
  | { kind: "voice" }
  | { kind: "pinned" }
  | { kind: "tag"; tag: string };

/** A full screen of the phone layout. */
export type PhoneScreen =
  | { kind: "home" }
  | { kind: "folder"; path: string }
  /** The open shard, or the open drawing when Canvas is the mode. */
  | { kind: "file" }
  /** Search, in one folder when `folder` is set. */
  | { kind: "search"; folder?: string; filter?: SearchFilter }
  | { kind: "tags" }
  | { kind: "settings"; category: SettingsCategory | null }
  /** What was deleted from the open vault, to restore or delete for good. */
  | { kind: "trash" };

/** A sheet or menu over the screen under it. */
export type PhoneOverlay =
  | { kind: "vault-menu" }
  | { kind: "new-vault" }
  | { kind: "more-menu"; folder: string | null }
  | { kind: "new-folder"; parent: string }
  | { kind: "shard-menu" }
  | { kind: "assistant" }
  | { kind: "history" }
  /** An earlier version of the open shard, over its history. */
  | { kind: "version" }
  /** A change the assistant proposed, shown in the open shard. */
  | { kind: "change" }
  /** A row's long-press menu. */
  | { kind: "row-menu"; path: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; paths: string[] }
  | { kind: "confirm-trash"; paths: string[] }
  /** Picking shards to pin, move or delete together. */
  | { kind: "select" }
  /** A trash item's menu: Restore or Delete forever. */
  | { kind: "trash-item"; id: string }
  | { kind: "confirm-delete-forever"; ids: string[] }
  | { kind: "confirm-empty-trash" }
  /** What another app shared, to save in a new shard or add to one. */
  | { kind: "share-in" }
  /** Picking the folder or shard a share goes in, over its sheet. */
  | { kind: "share-place"; choose: "folder" | "shard" };

type Entry = PhoneScreen | PhoneOverlay;

const SCREEN_KINDS = new Set<string>([
  "home",
  "folder",
  "file",
  "search",
  "tags",
  "settings",
  "trash",
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
  /** Goes back until `kind` and everything over it have closed. */
  closeFrom: (kind: Entry["kind"]) => void;
  /** Keeps the first `count` entries, after the browser went back. */
  truncate: (count: number) => void;
}

/** The key under which each history entry records its place in `entries`. */
const DEPTH_KEY = "phoneDepth";

function depthOf(state: unknown): number {
  const depth = (state as Record<string, unknown> | null)?.[DEPTH_KEY];
  return typeof depth === "number" ? depth : 0;
}

// Set while the browser is going back, until it says where it landed, so a
// second close before then doesn't go back twice.
let goingBack = false;

function goBack(steps: number) {
  if (goingBack || steps <= 0) return;
  goingBack = true;
  history.go(-steps);
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
    goBack(Math.min(1, get().entries.length - 1));
  },
  closeFrom: (kind) => {
    const { entries } = get();
    const at = entries.findIndex((entry) => entry.kind === kind);
    if (at > 0) goBack(entries.length - at);
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
  const onPop = (event: PopStateEvent) => {
    goingBack = false;
    usePhoneNav.getState().truncate(depthOf(event.state) + 1);
  };
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}

/**
 * Has Android's Back close the top sheet or screen, and close the app from
 * home. The app decides rather than the webview, whose Back can skip
 * history entries that were added without a tap. Returns a cleanup.
 */
export function followSystemBack(): () => void {
  const listening = onBackButtonPress(() => {
    const { entries, back } = usePhoneNav.getState();
    if (entries.length > 1) back();
    else void exit();
  }).catch(() => null);
  return () => {
    void listening.then((listener) => listener?.unregister());
  };
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

/** Whether shards are being picked to act on together. */
export function useSelecting(): boolean {
  return usePhoneNav((s) => s.entries.some((entry) => entry.kind === "select"));
}

type OverlayOf<K extends PhoneOverlay["kind"]> = Extract<PhoneOverlay, { kind: K }>;

/**
 * The overlay of `kind` while it's open, and the last one after it closes,
 * so its sheet can slide away showing what it showed.
 */
export function useLast<K extends PhoneOverlay["kind"]>(kind: K) {
  const overlay = usePhoneOverlay();
  const [last, setLast] = useState<OverlayOf<K> | null>(null);
  const current = overlay?.kind === kind ? (overlay as OverlayOf<K>) : null;
  if (current && current !== last) setLast(current);
  return { open: current !== null, overlay: current ?? last };
}

/** Closes `kind` when its sheet or dialog asks to, unless it's gone already. */
export function closer(kind: PhoneOverlay["kind"]) {
  return (open: boolean) => {
    if (open) return;
    const { entries, back } = usePhoneNav.getState();
    if (entries[entries.length - 1]?.kind === kind) back();
  };
}