import { useEffect } from "react";
import { endRecentCycle } from "@/lib/recent-files";
import { getShortcut, releasesShortcut } from "@/lib/shortcuts";
import { useSettingsStore } from "@/store/settings";

const STEPS = [getShortcut("nextRecent"), getShortcut("previousRecent")];

/**
 * Ends a walk through Recent (Ctrl+Tab, see `useAppShortcuts`) when its
 * modifier is let go or the window loses focus.
 */
export function useRecentSwitching() {
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      const { shortcuts } = useSettingsStore.getState();
      if (STEPS.some((step) => releasesShortcut(e, step, shortcuts))) {
        endRecentCycle();
      }
    };

    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", endRecentCycle);
    return () => {
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", endRecentCycle);
    };
  }, []);
}
