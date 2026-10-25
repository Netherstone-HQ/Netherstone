import { useEffect } from "react";
import { hasModKey } from "@/lib/platform";
import {
  DEFAULT_PREFERENCES,
  stepZoom,
  useSettingsStore,
} from "@/store/settings";
import { RAIL_MODES, useUIStore } from "@/store/ui";

// Ctrl+1 to 5 in rail order, by physical key, so they work on layouts where
// those keys type symbols (AZERTY's "&é\"").
const MODE_KEYS: Record<string, (typeof RAIL_MODES)[number]> =
  Object.fromEntries(RAIL_MODES.map((mode, i) => [`Digit${i + 1}`, mode]));

// Zoom by the character typed, with or without Shift: "+" is Shift+= on many
// layouts, and AZERTY types "0" with Shift. The number pad sends the same.
const ZOOM_KEYS: Record<string, 1 | -1 | 0> = {
  "=": 1,
  "+": 1,
  "-": -1,
  "0": 0,
};

/**
 * App-wide shortcuts: Ctrl+1 to 5 (⌘ on a Mac) switch between Editor,
 * Canvas, Tags, Gallery and Overview, Ctrl+N starts a new shard, and Ctrl+= / Ctrl+− /
 * Ctrl+0 zoom the interface. Listed in Settings › Shortcuts.
 */
export function useAppShortcuts({ onNewShard }: { onNewShard: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hasModKey(e) || e.altKey) return;

      const zoomStep = ZOOM_KEYS[e.key];
      if (zoomStep !== undefined) {
        // Canvas keeps these keys for zooming the drawing.
        if (useUIStore.getState().appMode === "canvas") return;
        e.preventDefault();
        const { zoom, setPreference } = useSettingsStore.getState();
        setPreference(
          "zoom",
          zoomStep === 0 ? DEFAULT_PREFERENCES.zoom : stepZoom(zoom, zoomStep),
        );
        return;
      }

      if (e.shiftKey || e.repeat) return;

      const mode = MODE_KEYS[e.code];
      if (mode) {
        e.preventDefault();
        useUIStore.getState().openMode(mode);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewShard();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewShard]);
}
