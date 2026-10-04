import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { errorMessage } from "@/lib/github-account";
import { canUpdate } from "@/lib/updates";
import { useUpdatesStore } from "@/store/updates";

const TOAST_ID = "app-update";

/** Offers to install the update, if one is available. */
export function showUpdateToast(version: string) {
  toast(`Netherstone ${version} is available`, {
    id: TOAST_ID,
    duration: Infinity,
    action: {
      label: "Restart to update",
      onClick: () => void installUpdateWithToast(version),
    },
  });
}

/** Installs the available update, showing progress and problems in a toast. */
export async function installUpdateWithToast(version: string) {
  toast.loading(`Updating to Netherstone ${version}…`, {
    id: TOAST_ID,
    duration: Infinity,
  });
  try {
    await useUpdatesStore.getState().install();
  } catch (error) {
    toast.error("Couldn't install the update", {
      id: TOAST_ID,
      description: errorMessage(error),
      duration: 8_000,
    });
  }
}

/**
 * Checks for an update once per launch, when `enabled` first turns true,
 * and offers to install it. Problems stay quiet here; Settings shows them.
 */
export function useUpdateCheck(enabled: boolean) {
  const checked = useRef(false);

  useEffect(() => {
    if (!enabled || checked.current || !canUpdate()) return;
    checked.current = true;
    void useUpdatesStore
      .getState()
      .check()
      .then((update) => {
        if (update) showUpdateToast(update.version);
      });
  }, [enabled]);
}
