import { lazy, Suspense } from "react";

import { useImportDialogStore } from "@/lib/import";

const ImportDialog = lazy(() =>
  import("./ImportDialog").then((module) => ({ default: module.ImportDialog })),
);

/** Loads the import window the first time it opens, not at startup. */
export function ImportDialogHost() {
  const isOpen = useImportDialogStore((s) => s.targetDir !== null);
  if (!isOpen) return null;

  return (
    <Suspense fallback={null}>
      <ImportDialog />
    </Suspense>
  );
}
