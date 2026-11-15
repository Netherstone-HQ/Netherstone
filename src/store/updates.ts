import { create } from "zustand";

import { saveBeforeQuit } from "@/hooks/useAutosave";
import { errorMessage } from "@/lib/github-account";
import {
  type AvailableUpdate,
  checkForUpdate,
  downloadUpdate,
  installUpdate,
} from "@/lib/updates";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  /** `percent` is null until the size of the download is known. */
  | { kind: "downloading"; update: AvailableUpdate; percent: number | null }
  | { kind: "ready"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate }
  | {
      kind: "error";
      failed: "check" | "download" | "install";
      message: string;
    };

interface UpdatesState {
  status: UpdateStatus;
  /**
   * Checks the channel chosen in Settings and downloads the update it finds.
   * Resolves to the update, if any, once the download is done.
   */
  check: () => Promise<AvailableUpdate | null>;
  /**
   * Saves open work, then installs the downloaded update. The app restarts
   * when it succeeds.
   */
  install: () => Promise<void>;
  /** Forgets the last result, e.g. after switching channels. */
  reset: () => void;
}

// A check or download that finishes after a newer check started is ignored.
let attempt = 0;

export const useUpdatesStore = create<UpdatesState>((set, get) => {
  const download = async (update: AvailableUpdate, id: number) => {
    set({ status: { kind: "downloading", update, percent: null } });
    try {
      await downloadUpdate((percent) => {
        if (id === attempt) {
          set({ status: { kind: "downloading", update, percent } });
        }
      });
      if (id === attempt) set({ status: { kind: "ready", update } });
    } catch (error) {
      if (id === attempt) {
        set({
          status: {
            kind: "error",
            failed: "download",
            message: errorMessage(error),
          },
        });
      }
    }
  };

  return {
    status: { kind: "idle" },

    check: async () => {
      const current = get().status.kind;
      if (
        current === "checking" ||
        current === "downloading" ||
        current === "installing"
      ) {
        return null;
      }

      const id = ++attempt;
      set({ status: { kind: "checking" } });
      try {
        const update = await checkForUpdate(
          useSettingsStore.getState().betaUpdates,
        );
        if (id === attempt) {
          if (update) await download(update, id);
          else set({ status: { kind: "up-to-date" } });
        }
        return update;
      } catch (error) {
        if (id === attempt) {
          set({
            status: {
              kind: "error",
              failed: "check",
              message: errorMessage(error),
            },
          });
        }
        return null;
      }
    },

    install: async () => {
      const status = get().status;
      if (status.kind !== "ready") return;

      // Quitting now would drop the edits; the choice is on screen.
      if (useEditorStore.getState().outsideChange) {
        throw new Error("Choose which version of the open shard to keep first.");
      }

      set({ status: { kind: "installing", update: status.update } });
      try {
        await saveBeforeQuit();
        await installUpdate();
      } catch (error) {
        set({
          status: {
            kind: "error",
            failed: "install",
            message: errorMessage(error),
          },
        });
        throw error;
      }
    },

    reset: () => {
      if (get().status.kind === "installing") return;
      attempt++;
      set({ status: { kind: "idle" } });
    },
  };
});

// A result from the other channel no longer applies.
useSettingsStore.subscribe((state, previous) => {
  if (state.betaUpdates !== previous.betaUpdates) {
    useUpdatesStore.getState().reset();
  }
});
