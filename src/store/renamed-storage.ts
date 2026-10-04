import { createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * localStorage for a persisted store whose key was renamed. The first read
 * moves the value saved under `legacyName` to the new key, so nothing saved
 * before the rename is lost.
 */
export function renamedLocalStorage<S>(legacyName: string) {
  const storage: StateStorage = {
    getItem: (name) => {
      const value = localStorage.getItem(name);
      if (value !== null) return value;
      const legacy = localStorage.getItem(legacyName);
      if (legacy === null) return null;
      localStorage.setItem(name, legacy);
      localStorage.removeItem(legacyName);
      return legacy;
    },
    setItem: (name, value) => localStorage.setItem(name, value),
    removeItem: (name) => localStorage.removeItem(name),
  };
  return createJSONStorage<S>(() => storage);
}
