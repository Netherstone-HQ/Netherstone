/** Finds the sync to run before the app closes, while automatic sync is on. */
let findSync: (() => (() => Promise<void>) | null) | null = null;

/** Sets what decides the sync before quitting; returns the undo. */
export function setSyncBeforeQuit(find: () => (() => Promise<void>) | null) {
  findSync = find;
  return () => {
    if (findSync === find) findSync = null;
  };
}

/**
 * The sync to run before the app closes, or null when edits are all synced
 * or automatic sync is off. Ask before saving, since unsaved edits count.
 */
export function syncBeforeQuit(): (() => Promise<void>) | null {
  return findSync?.() ?? null;
}
