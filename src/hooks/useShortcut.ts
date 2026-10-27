import { getShortcut, type Keys, type ShortcutId, shownKeys } from "@/lib/shortcuts";
import { useSettingsStore } from "@/store/settings";

/**
 * The keys a shortcut shows ("mod+b"), or null when it has none. Follows
 * changes made in Settings › Shortcuts.
 */
export function useShortcutKeys(id: ShortcutId | undefined): Keys | null {
  return useSettingsStore((s) =>
    id ? (shownKeys(getShortcut(id), s.shortcuts)[0] ?? null) : null,
  );
}
