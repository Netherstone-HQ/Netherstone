import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PhonePrefsState {
  /** Shards in a folder newest first, instead of by name. */
  sortByDate: boolean;
  setSortByDate: (sortByDate: boolean) => void;
  /** Each vault's last searches that opened something, newest first. */
  recentSearches: Record<string, string[]>;
  addRecentSearch: (vaultPath: string, query: string) => void;
}

/** How many recent searches Search keeps for a vault. */
const RECENT_SEARCHES = 5;

/** Choices made in the phone layout, kept across restarts. */
export const usePhonePrefs = create<PhonePrefsState>()(
  persist(
    (set) => ({
      sortByDate: false,
      setSortByDate: (sortByDate) => set({ sortByDate }),
      recentSearches: {},
      addRecentSearch: (vaultPath, query) =>
        set((state) => ({
          recentSearches: {
            ...state.recentSearches,
            [vaultPath]: [
              query,
              ...(state.recentSearches[vaultPath] ?? []).filter(
                (q) => q !== query,
              ),
            ].slice(0, RECENT_SEARCHES),
          },
        })),
    }),
    { name: "netherstone-phone" },
  ),
);
