import { lazy, Suspense } from "react";

import { useExportDialogStore } from "@/lib/export";

const ExportDialog = lazy(() =>
  import("./ExportDialog").then((module) => ({ default: module.ExportDialog })),
);

/** Loads the export window the first time it opens, not at startup. */
export function ExportDialogHost() {
  const isOpen = useExportDialogStore((s) => s.filePath !== null);
  if (!isOpen) return null;

  return (
    <Suspense fallback={null}>
      <ExportDialog />
    </Suspense>
  );
}
