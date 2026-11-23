import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PhonePrefsState {
  /** Shards in a folder newest first, instead of by name. */
  sortByDate: boolean;
  setSortByDate: (sortByDate: boolean) => void;
}

/** Choices made in the phone layout, kept across restarts. */
export const usePhonePrefs = create<PhonePrefsState>()(
  persist(
    (set) => ({
      sortByDate: false,
      setSortByDate: (sortByDate) => set({ sortByDate }),
    }),
    { name: "netherstone-phone" },
  ),
);
