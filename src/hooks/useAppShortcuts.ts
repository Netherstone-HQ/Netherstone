import { useEffect } from "react";
import { RAIL_MODES, useUIStore } from "@/store/ui";

// Ctrl+1/2/3 by physical key, so they work on layouts where those keys type
// symbols (AZERTY's "&é\"").
const MODE_KEYS: Record<string, (typeof RAIL_MODES)[number]> = {
  Digit1: RAIL_MODES[0],
  Digit2: RAIL_MODES[1],
  Digit3: RAIL_MODES[2],
};

/**
 * App-wide shortcuts: Ctrl+1/2/3 (⌘ on a Mac) switch between Editor, Tags
 * and Canvas, and Ctrl+N starts a new shard. Listed in Settings › Shortcuts.
 */
export function useAppShortcuts({ onNewShard }: { onNewShard: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) {
        return;
      }

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
