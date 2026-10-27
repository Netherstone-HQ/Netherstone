import { useEffect } from "react";
import { stepRecentFile } from "@/lib/recent-files";
import { findShortcut, type ShortcutIdIn } from "@/lib/shortcuts";
import {
  DEFAULT_PREFERENCES,
  stepZoom,
  useSettingsStore,
} from "@/store/settings";
import { useUIStore } from "@/store/ui";

/** Set on the control that records new keys in Settings. */
export const SHORTCUT_RECORDER_ATTRIBUTE = "data-shortcut-recorder";

function zoom(step: 1 | -1 | 0): boolean {
  // Canvas keeps zoom for the drawing.
  if (useUIStore.getState().appMode === "canvas") return false;
  const { zoom, setPreference } = useSettingsStore.getState();
  setPreference(
    "zoom",
    step === 0 ? DEFAULT_PREFERENCES.zoom : stepZoom(zoom, step),
  );
  return true;
}

function isIn(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Runs the app's shortcuts (search, new shard, save, the sidebar, the
 * rail's modes, Recent and zoom) on whatever keys Settings › Shortcuts has
 * for them. An action returns false to let the keys through.
 */
export function useAppShortcuts({
  onNewShard,
  onSave,
}: {
  onNewShard: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    const ui = useUIStore.getState;
    const actions: Record<ShortcutIdIn<"app">, () => boolean | void> = {
      search: () => ui().toggleSearchModal(),
      newShard: onNewShard,
      save: () => {
        // Canvas keeps it for the drawing.
        if (ui().appMode === "canvas") return false;
        onSave();
      },
      toggleSidebar: () => ui().setSidebarOpen(!ui().isSidebarOpen),
      openEditor: () => ui().openMode("editor"),
      openCanvas: () => ui().openMode("canvas"),
      openTags: () => ui().openMode("tags"),
      openGallery: () => ui().openMode("gallery"),
      openOverview: () => ui().openMode("data"),
      nextRecent: () => stepRecentFile(1),
      previousRecent: () => stepRecentFile(-1),
      zoomIn: () => zoom(1),
      zoomOut: () => zoom(-1),
      resetZoom: () => zoom(0),
    };

    // Caught before anything else, so the editor doesn't indent on Ctrl+Tab
    // or open its link box on Ctrl+K.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isIn(e.target, `[${SHORTCUT_RECORDER_ATTRIBUTE}]`)) return;
      const { shortcuts } = useSettingsStore.getState();
      const shortcut = findShortcut(e, "app", shortcuts);
      if (!shortcut || (e.repeat && !("repeats" in shortcut))) return;
      // Typing in a shard, the editor's own shortcut on the same keys wins:
      // Mod+B is Bold there and the sidebar everywhere else.
      if (
        isIn(e.target, "[data-slate-editor]") &&
        findShortcut(e, "editor", shortcuts)
      ) {
        return;
      }
      if (actions[shortcut.id]() === false) return;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onNewShard, onSave]);
}
