import { useEffect, useRef, useState } from "react";
import { FilesIcon, FolderIcon, LoaderCircleIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { listImportSources, pickImportPaths, undoImport } from "@/lib/commands";
import { useImportDialogStore } from "@/lib/import";
import { appImportIO } from "@/lib/import/app-io";
import { carriesFiles, readDrop } from "@/lib/import/dropped";
import { runImport, type ImportIO, type ImportProgress, type ImportReport, type ImportSource } from "@/lib/import/engine";
import { IMPORTERS } from "@/lib/import/registry";
import { openEditorFile } from "@/lib/open-editor-file";
import { folderName } from "@/lib/open-vault";
import { refreshVault } from "@/lib/refresh-vault";
import { useVaultStore } from "@/store";

type Step =
  | { kind: "pick" }
  | { kind: "importing"; progress: ImportProgress | null }
  /** `since`: when the import started, in unix seconds, for Undo. */
  | { kind: "done"; report: ImportReport; vaultPath: string; since: number; isUndoing?: boolean };

/** The import window: pick or drop files or a folder, watch them convert, see what came in. */
export function ImportDialog() {
  const targetDir = useImportDialogStore((s) => s.targetDir);
  const close = useImportDialogStore((s) => s.close);

  return (
    <Dialog open={targetDir !== null} onOpenChange={(open) => !open && close()}>
      {targetDir !== null ? <ImportWindow key={targetDir} targetDir={targetDir} onClose={close} /> : null}
    </Dialog>
  );
}

function ImportWindow({ targetDir, onClose }: { targetDir: string; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [isPicking, setIsPicking] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [bringAttachments, setBringAttachments] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const isImporting = step.kind === "importing";

  // Closing the window mid-import stops it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = async (folder: boolean) => {
    const vaultPath = useVaultStore.getState().currentVaultPath;
    if (!vaultPath) return;

    setIsPicking(true);
    let paths: string[];
    try {
      paths = await pickImportPaths(folder);
    } finally {
      setIsPicking(false);
    }
    if (!paths.length) return;
    await start(vaultPath, () => listImportSources(paths), appImportIO(vaultPath));
  };

  const drop = async (event: React.DragEvent) => {
    setIsDragOver(false);
    if (!carriesFiles(event.dataTransfer)) return;
    // Left alone, a dropped file would replace the app in the window.
    event.preventDefault();
    const vaultPath = useVaultStore.getState().currentVaultPath;
    if (step.kind !== "pick" || isPicking || !vaultPath) return;
    const dropped = readDrop(event.dataTransfer);
    // Dropped files have no path on disk to look for what they use.
    await start(vaultPath, async () => (await dropped).sources, {
      ...appImportIO(vaultPath),
      readFile: async (path) => (await dropped).read(path),
      copyAttachment: undefined,
      exists: undefined,
    });
  };

  const dragOver = (event: React.DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    const accepts = step.kind === "pick" && !isPicking;
    event.dataTransfer.dropEffect = accepts ? "copy" : "none";
    setIsDragOver(accepts);
  };

  const start = async (vaultPath: string, listSources: () => Promise<ImportSource[]>, io: ImportIO) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStep({ kind: "importing", progress: null });
    const since = Math.floor(Date.now() / 1000);

    let report: ImportReport;
    try {
      report = await runImport({
        sources: await listSources(),
        targetDir,
        bringAttachments,
        io,
        signal: controller.signal,
        onProgress: (progress) => setStep({ kind: "importing", progress }),
      });
    } catch (error) {
      console.error("[Netherstone] Import failed:", error);
      report = {
        created: [],
        attachments: [],
        skipped: [],
        failed: [{ source: "", error: error instanceof Error ? error.message : String(error) }],
        cancelled: false,
      };
    }
    abortRef.current = null;

    if (report.created.length) {
      await refreshVault(vaultPath).catch((error) =>
        console.error("[Netherstone] Couldn't refresh the vault after importing:", error),
      );
    }
    setStep({ kind: "done", report, vaultPath, since });
  };

  const undo = async () => {
    if (step.kind !== "done") return;
    const { report, vaultPath, since } = step;
    setStep({ ...step, isUndoing: true });
    try {
      await undoImport(
        vaultPath,
        targetDir,
        report.created.map((shard) => shard.path),
        report.attachments,
        since,
      );
    } catch (error) {
      console.error("[Netherstone] Couldn't undo the import:", error);
      alert(error instanceof Error ? error.message : String(error));
    }
    await refreshVault(vaultPath).catch((error) =>
      console.error("[Netherstone] Couldn't refresh the vault after undoing an import:", error),
    );
    onClose();
  };

  const openShard = async (path: string) => {
    onClose();
    await openEditorFile(path);
  };

  return (
    <DialogContent
      className="gap-5 sm:max-w-md"
      showCloseButton={!isImporting}
      onEscapeKeyDown={(event) => isImporting && event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onDragOver={dragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false);
      }}
      onDrop={(event) => void drop(event)}
    >
      <div className="space-y-1">
        <DialogTitle className="font-medium text-base">Import</DialogTitle>
        <DialogDescription className="truncate text-muted-foreground text-ui" title={targetDir}>
          Into {folderName(targetDir)}
        </DialogDescription>
      </div>

      {step.kind === "pick" ? (
        <>
          <div className="relative grid grid-cols-2 gap-2">
            <SourceButton icon={FilesIcon} label="Files" disabled={isPicking} onClick={() => void pick(false)} />
            <SourceButton icon={FolderIcon} label="A folder" disabled={isPicking} onClick={() => void pick(true)} />
            {isDragOver ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-primary border-dashed bg-background text-ui-sm">
                Drop to import
              </div>
            ) : null}
          </div>
          <ul className="flex flex-wrap gap-1">
            {IMPORTERS.map((importer) => (
              <li key={importer.label} className="rounded border border-border px-1.5 text-muted-foreground text-ui-sm">
                {importer.label}
              </li>
            ))}
          </ul>
          <label className="flex w-fit items-center gap-2 text-ui-sm">
            <Checkbox checked={bringAttachments} onCheckedChange={(checked) => setBringAttachments(checked === true)} />
            Bring attachments
          </label>
        </>
      ) : null}

      {step.kind === "importing" ? <Importing progress={step.progress} /> : null}

      {step.kind === "done" ? <Summary report={step.report} onOpen={(path) => void openShard(path)} /> : null}

      <div className="flex justify-end gap-2">
        {step.kind === "importing" ? (
          <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        ) : step.kind === "done" ? (
          <>
            {step.report.created.length ? (
              <Button variant="ghost" disabled={step.isUndoing} onClick={() => void undo()}>
                Undo import
              </Button>
            ) : null}
            <Button disabled={step.isUndoing} onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </DialogContent>
  );
}

function SourceButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-border px-2 py-4 text-muted-foreground text-ui-sm transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="size-6" />
      {label}
    </button>
  );
}

function Importing({ progress }: { progress: ImportProgress | null }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const value = total ? (done / total) * 100 : 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-ui">
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={progress?.current ?? undefined}>
          {progress?.current ? fileName(progress.current) : "Finding files…"}
        </span>
        {total > 1 ? (
          <span className="shrink-0 text-muted-foreground text-ui-sm tabular-nums">
            {Math.min(done + 1, total)} of {total}
          </span>
        ) : null}
      </div>
      <Progress value={value} />
      <p className="h-4 text-muted-foreground text-ui-sm">{progress?.detail ?? ""}</p>
    </div>
  );
}

function Summary({ report, onOpen }: { report: ImportReport; onOpen: (path: string) => void }) {
  const { created, skipped, failed, cancelled } = report;

  let headline: string;
  if (created.length === 0 && failed.length === 0) {
    headline = cancelled ? "Import cancelled. Nothing was added." : "There was nothing Netherstone can import.";
  } else {
    headline = created.length === 1 ? "Imported 1 shard." : `Imported ${created.length} shards.`;
    if (cancelled) headline = `Import cancelled. ${headline}`;
  }

  return (
    <div className="space-y-3 text-ui">
      <p>{headline}</p>

      {created.length || failed.length ? (
        <ul className="-mx-2 max-h-72 overflow-y-auto">
          {created.map((shard) => (
            <Row key={shard.path} name={fileName(shard.path).replace(/\.md$/i, "")} notes={shard.warnings}>
              <Button variant="ghost" size="xs" onClick={() => onOpen(shard.path)}>
                Open
              </Button>
            </Row>
          ))}
          {failed.map((item, index) => (
            <Row key={`${item.source}:${index}`} name={item.source ? fileName(item.source) : "Import"} notes={[item.error]} />
          ))}
        </ul>
      ) : null}

      {skipped.length ? (
        <p className="text-muted-foreground text-ui-sm">
          {skipped.length === 1
            ? `Left out ${fileName(skipped[0])}, a kind of file Netherstone doesn't import.`
            : `Left out ${skipped.length} files of kinds Netherstone doesn't import.`}
        </p>
      ) : null}
    </div>
  );
}

/** One shard or file in the summary, with what's worth knowing about it. */
function Row({ name, notes, children }: { name: string; notes: string[]; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-md px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate" title={name}>
          {name}
        </p>
        {notes.length ? <p className="text-muted-foreground text-ui-sm leading-5">{notes.join(" ")}</p> : null}
      </div>
      {children}
    </li>
  );
}

function fileName(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}
