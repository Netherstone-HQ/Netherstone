import { useEffect } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { openImportDialog, useImportDialogStore } from "@/lib/import";

const TOAST_ID = "import";

/**
 * An import running with its window closed, as a toast: how far it got,
 * then what came in, with the way back to the summary.
 */
export function ImportToast() {
  const job = useImportDialogStore((s) => (s.targetDir === null ? s.job : null));

  useEffect(() => {
    if (!job) {
      toast.dismiss(TOAST_ID);
      return;
    }

    if (job.step.kind === "importing") {
      const total = job.step.progress?.total ?? 0;
      const done = job.step.progress?.done ?? 0;
      // Not toast.loading: Sonner draws its own spinner after the words for those.
      toast(total > 1 ? `Importing ${Math.min(done + 1, total)} of ${total}` : "Importing", {
        id: TOAST_ID,
        icon: <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />,
        duration: Infinity,
      });
      return;
    }

    const created = job.step.report.created.length;
    toast.success(created === 1 ? "Imported 1 shard" : created ? `Imported ${created} shards` : "Import finished", {
      id: TOAST_ID,
      duration: Infinity,
      action: { label: "Open summary", onClick: () => openImportDialog(job.targetDir) },
      // Done with the import, as the summary's Done is.
      cancel: { label: "Done", onClick: () => useImportDialogStore.getState().close() },
    });
  }, [job]);

  return null;
}
