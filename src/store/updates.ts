import { create } from "zustand";

import { errorMessage } from "@/lib/github-account";
import {
  type AvailableUpdate,
  checkForUpdate,
  installUpdate,
} from "@/lib/updates";
import { useSettingsStore } from "@/store/settings";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate }
  | { kind: "error"; message: string };

interface UpdatesState {
  status: UpdateStatus;
  /** Checks the channel chosen in Settings. Resolves to the update, if any. */
  check: () => Promise<AvailableUpdate | null>;
  /** Installs the available update. The app restarts when it succeeds. */
  install: () => Promise<void>;
  /** Forgets the last result, e.g. after switching channels. */
  reset: () => void;
}

// A check that finishes after a newer one started is ignored.
let attempt = 0;

export const useUpdatesStore = create<UpdatesState>((set, get) => ({
  status: { kind: "idle" },

  check: async () => {
    const current = get().status.kind;
    if (current === "checking" || current === "installing") return null;

    const id = ++attempt;
    set({ status: { kind: "checking" } });
    try {
      const update = await checkForUpdate(
        useSettingsStore.getState().betaUpdates,
      );
      if (id === attempt) {
        set({
          status: update
            ? { kind: "available", update }
            : { kind: "up-to-date" },
        });
      }
      return update;
    } catch (error) {
      if (id === attempt) {
        set({ status: { kind: "error", message: errorMessage(error) } });
      }
      return null;
    }
  },

  install: async () => {
    const status = get().status;
    if (status.kind !== "available") return;

    set({ status: { kind: "installing", update: status.update } });
    try {
      await installUpdate();
    } catch (error) {
      set({ status: { kind: "error", message: errorMessage(error) } });
      throw error;
    }
  },

  reset: () => {
    if (get().status.kind === "installing") return;
    attempt++;
    set({ status: { kind: "idle" } });
  },
}));

// A result from the other channel no longer applies.
useSettingsStore.subscribe((state, previous) => {
  if (state.betaUpdates !== previous.betaUpdates) {
    useUpdatesStore.getState().reset();
  }
});
