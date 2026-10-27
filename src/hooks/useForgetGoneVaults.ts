import { useEffect } from "react";

import { forgetGoneVaults } from "@/lib/gone-vaults";

/** Once the app starts, forgets the vaults whose folder is gone. */
export function useForgetGoneVaults() {
  useEffect(() => {
    forgetGoneVaults().catch((error) => {
      console.error("[Netherstone] Couldn't forget deleted vaults:", error);
    });
  }, []);
}
