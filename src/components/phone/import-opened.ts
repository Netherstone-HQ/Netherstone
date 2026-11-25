import { toast } from "sonner";
import { listImportSources, undoImport } from "@/lib/commands/import";
import { appImportIO } from "@/lib/import/app-io";
import { runImport, type ImportReport } from "@/lib/import/engine";
import { waitingText } from "@/lib/launch";
import { refreshVault } from "@/lib/refresh-vault";
import { useEditorStore } from "@/store";
import { fileName } from "@/lib/drawing-files";
import { usePhoneNav } from "./nav";
import { openFileScreen } from "./open-file";
import { reportFailure, UNDO_TOAST_MS } from "./toasts";

const IMPORT_TOAST_ID = "imported";

/** Imports files opened with Netherstone (Open with) and opens the first, with Undo. */
export async function importOpened(vaultPath: string, paths: string[]) {
  const names = waitingText(paths.map(fileName));
  const since = Math.floor(Date.now() / 1000);
  let report: ImportReport;
  try {
    report = await runImport({
      sources: await listImportSources(paths),
      targetDir: vaultPath,
      io: appImportIO(vaultPath),
    });
  } catch (error) {
    reportFailure(`Couldn't import ${names}`, error);
    return;
  }

  const [first] = report.created;
  if (first) {
    await refreshVault(vaultPath);
    await openFileScreen(first.path);
    const undo = async () => {
      try {
        await undoImport(
          vaultPath,
          vaultPath,
          report.created.map((shard) => shard.path),
          report.attachments,
          since,
        );
      } catch (error) {
        reportFailure("Couldn't undo the import", error);
        return;
      }
      const shown = useEditorStore.getState().currentFilePath;
      if (report.created.some((shard) => shard.path === shown))
        usePhoneNav.getState().back();
      await refreshVault(vaultPath);
    };
    toast(`Imported ${waitingText(report.created.map((shard) => fileName(shard.source)))}`, {
      id: IMPORT_TOAST_ID,
      duration: UNDO_TOAST_MS,
      action: { label: "Undo", onClick: () => void undo() },
    });
  }

  const failed = [
    ...report.failed.map((failure) => failure.source),
    ...report.skipped,
  ].filter(Boolean);
  if (failed.length || !first) {
    toast.error(
      `Couldn't import ${failed.length ? waitingText(failed.map(fileName)) : names}`,
      { description: report.failed[0]?.error },
    );
  }
}
