import { useEffect } from "react";
import { useVaultStore } from "@/store";
import { dismissSplash } from "@/lib/splash";

/**
 * Lifts the launch splash once the last vault has been read back from disk,
 * so the app never appears with an empty sidebar that fills in a moment
 * later. Call it after useVaultInit, which starts that read.
 */
export function useDismissSplash() {
  const isVaultLoading = useVaultStore((state) => state.isVaultLoading);

  useEffect(() => {
    // Read the store directly: on the first render this hook's value is
    // still from before useVaultInit's effect marked the vault as loading.
    if (!useVaultStore.getState().isVaultLoading) dismissSplash();
  }, [isVaultLoading]);
}
