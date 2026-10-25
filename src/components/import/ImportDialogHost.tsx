import { lazy, Suspense } from "react";

import { useImportDialogStore } from "@/lib/import";

import { ImportToast } from "./ImportToast";

const ImportDialog = lazy(() =>
  import("./ImportDialog").then((module) => ({ default: module.ImportDialog })),
);

/**
 * Loads the import window the first time it opens, not at startup, and
 * shows an import that runs with the window closed.
 */
export function ImportDialogHost() {
  const isOpen = useImportDialogStore((s) => s.targetDir !== null);

  return (
    <>
      <ImportToast />
      {isOpen ? (
        <Suspense fallback={null}>
          <ImportDialog />
        </Suspense>
      ) : null}
    </>
  );
}
