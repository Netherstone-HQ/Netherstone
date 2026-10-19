import { useEffect, useRef, useState } from "react";
import { FilesIcon, FolderIcon, LoaderCircleIcon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { listImportSources, pickImportPaths } from "@/lib/commands";
import { useImportDialogStore } from "@/lib/import";
import { appImportIO } from "@/lib/import/app-io";
import { runImport, type ImportProgress, type ImportReport } from "@/lib/import/engine";
import { openEditorFile } from "@/lib/open-editor-file";
import { folderName } from "@/lib/open-vault";
import { refreshVault } from "@/lib/refresh-vault";
import { useVaultStore } from "@/store";

type Step =
  | { kind: "pick" }
  | { kind: "importing"; progress: ImportProgress | null }
  | { kind: "done"; report: ImportReport };

/** The import window: pick files or a folder, watch them convert, see what came in. */
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
  const abortRef = useRef<AbortController | null>(null);
  const isImporting = step.kind === "importing";

  // Closing the window mid-import stops it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async (folder: boolean) => {
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

    const controller = new AbortController();
    abortRef.current = controller;
    setStep({ kind: "importing", progress: null });

    let report: ImportReport;
    try {
      report = await runImport({
        sources: await listImportSources(paths),
        targetDir,
        io: appImportIO(vaultPath),
        signal: controller.signal,
        onProgress: (progress) => setStep({ kind: "importing", progress }),
      });
    } catch (error) {
      console.error("[Netherstone] Import failed:", error);
      report = {
        created: [],
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
    setStep({ kind: "done", report });
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
    >
      <div className="space-y-1">
        <DialogTitle className="font-medium text-base">Import</DialogTitle>
        <DialogDescription className="truncate text-muted-foreground text-ui" title={targetDir}>
          Into {folderName(targetDir)}
        </DialogDescription>
      </div>

      {step.kind === "pick" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <SourceButton icon={FilesIcon} label="Files" disabled={isPicking} onClick={() => void start(false)} />
            <SourceButton icon={FolderIcon} label="A folder" disabled={isPicking} onClick={() => void start(true)} />
          </div>
          <p className="text-muted-foreground text-ui-sm leading-5">
            Word, PDF, web pages, Markdown, text and CSV files each become a shard. A folder keeps its folders, and
            pictures go in your attachments.
          </p>
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
            {step.report.created.length === 1 ? (
              <Button variant="ghost" onClick={() => void openShard(step.report.created[0].path)}>
                Open
              </Button>
            ) : null}
            <Button onClick={onClose}>Done</Button>
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
  const withWarnings = created.filter((shard) => shard.warnings.length);

  let headline: string;
  if (created.length === 0 && failed.length === 0) {
    headline = cancelled ? "Import cancelled. Nothing was added." : "There was nothing Netherstone can import.";
  } else {
    headline = created.length === 1 ? "Imported 1 shard." : `Imported ${created.length} shards.`;
    if (cancelled) headline = `Import cancelled. ${headline}`;
  }

  return (
    <div className="max-h-80 space-y-3 overflow-y-auto text-ui">
      <p>{headline}</p>

      {created.length > 1 && created.length <= 8 ? (
        <ul className="space-y-0.5">
          {created.map((shard) => (
            <li key={shard.path}>
              <button
                type="button"
                className="truncate text-left underline-offset-2 hover:underline"
                onClick={() => onOpen(shard.path)}
              >
                {fileName(shard.path).replace(/\.md$/i, "")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {failed.length ? (
        <Section title={failed.length === 1 ? "1 file couldn't be imported" : `${failed.length} files couldn't be imported`}>
          {failed.map((item, index) => (
            <li key={`${item.source}:${index}`}>
              {item.source ? <span className="text-foreground">{fileName(item.source)}: </span> : null}
              {item.error}
            </li>
          ))}
        </Section>
      ) : null}

      {withWarnings.length ? (
        <Section title="Worth a look">
          {withWarnings.map((shard) => (
            <li key={shard.path}>
              <span className="text-foreground">{fileName(shard.source)}: </span>
              {shard.warnings.join(" ")}
            </li>
          ))}
        </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      <ul className="space-y-1 text-muted-foreground text-ui-sm leading-5">{children}</ul>
    </div>
  );
}

function fileName(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}
