import { lazy, Suspense } from "react";

import { useSettingsStore } from "@/store/settings";

const Companion = lazy(() =>
  import("./Companion").then((module) => ({ default: module.Companion })),
);

/** Loads the companion only once he's been found and is switched on. */
export function CompanionHost() {
  const shown = useSettingsStore(
    (s) => s.companionUnlocked && s.showCompanion,
  );
  if (!shown) return null;

  return (
    <Suspense fallback={null}>
      <Companion />
    </Suspense>
  );
}
