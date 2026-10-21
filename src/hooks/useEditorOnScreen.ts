import { useUIStore } from "@/store";

/**
 * Whether the editor can be seen. It stays mounted, hidden, while another
 * view or Settings is open, so menus that follow its selection check this
 * before showing over them.
 */
export function useEditorOnScreen(): boolean {
  return useUIStore(
    (s) => s.appMode === "notes" && s.activeNavItem !== "settings",
  );
}
