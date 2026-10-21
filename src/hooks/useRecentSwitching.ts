import { useEffect } from "react";
import { endRecentCycle, stepRecentFile } from "@/lib/recent-files";

/**
 * Ctrl+Tab and Ctrl+Shift+Tab step through Recent. Ctrl on every system, as
 * in browsers, since ⌘+Tab switches apps on a Mac. Listed in
 * Settings › Shortcuts.
 */
export function useRecentSwitching() {
  useEffect(() => {
    // Caught before the editor, which indents on Tab.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      stepRecentFile(e.shiftKey ? -1 : 1);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control") endRecentCycle();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", endRecentCycle);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", endRecentCycle);
    };
  }, []);
}
