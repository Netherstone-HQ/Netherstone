import { useState } from "react";
import { toast } from "sonner";
import { FileInputIcon, Loader2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatBytes,
  getFileName,
  plural,
} from "@/components/settings/attachment-format";
import { persistAttachmentFile, type ExternalFile } from "@/lib/commands";
import { toVaultRelativePath } from "@/lib/drawing-files";
import { importLinkedFile, rewriteShards } from "@/lib/shard-rewrite";
import { useAttachmentReportStore } from "@/store";

function showError(message: string, error: unknown) {
  console.error(`[Netherstone] ${message}:`, error);
  toast.error(message, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Where an external file lives, for the import list. */
function getLocationLabel(file: ExternalFile, vaultPath: string) {
  if (!file.insideVault) return "on this device";

  const relative = toVaultRelativePath(file.absolutePath, vaultPath);
  const slashIndex = relative.lastIndexOf("/");
  return slashIndex >= 0 ? `in ${relative.slice(0, slashIndex)}/` : "in vault";
}

/**
 * Files shards link to outside `_attachments`, such as `images/a.png` or a
 * path on this device. Importing copies the chosen ones into the vault's
 * attachments and points their links at the copies.
 */
export function ExternalFilesRow({
  files,
  vaultPath,
}: {
  files: ExternalFile[];
  vaultPath: string;
}) {
  const check = useAttachmentReportStore((s) => s.check);
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const chosen = files.filter((file) => selected.has(file.absolutePath));
  const shardCount = new Set(
    files.flatMap((file) => file.uses.map((use) => use.shardPath)),
  ).size;

  const open = () => {
    setSelected(new Set(files.map((file) => file.absolutePath)));
    setIsOpen(true);
  };

  const importFiles = async () => {
    setIsWorking(true);
    try {
      // Copy each file first, then rewrite every shard once.
      const replacements = new Map<string, { link: string; asset: string }[]>();
      let failed = 0;

      for (const file of chosen) {
        try {
          const persisted = await persistAttachmentFile(
            file.absolutePath,
            vaultPath,
          );
          for (const use of file.uses) {
            const list = replacements.get(use.shardPath) ?? [];
            list.push({ link: use.link, asset: persisted.assetPath });
            replacements.set(use.shardPath, list);
          }
        } catch (error) {
          failed += 1;
          console.error("[Netherstone] Import failed:", file, error);
        }
      }

      await rewriteShards([...replacements.keys()], (markdown, shardPath) => {
        let next = markdown;
        for (const { link, asset } of replacements.get(shardPath) ?? []) {
          next = importLinkedFile(next, link, asset) ?? next;
        }
        return next === markdown ? null : next;
      });

      const imported = chosen.length - failed;
      if (imported > 0) {
        toast.success(`Imported ${plural(imported, "file")}`, {
          description:
            failed > 0
              ? `${plural(failed, "file")} couldn't be read and kept ${failed === 1 ? "its" : "their"} link.`
              : "The originals were left where they are.",
        });
      } else {
        toast.error("Couldn't import these files");
      }
    } catch (error) {
      showError("Couldn't import files", error);
    } finally {
      setIsWorking(false);
      setIsOpen(false);
      void check(vaultPath);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3 text-ui">
      <FileInputIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div>
          {plural(files.length, "file")} linked from outside the attachment
          folder
        </div>
        <p className="text-muted-foreground text-ui-sm">
          Used in {plural(shardCount, "shard")}. Importing copies them into this
          vault so they travel with it.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={open}>
        Import
      </Button>

      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isWorking) setIsOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import linked files</AlertDialogTitle>
            <AlertDialogDescription>
              Each chosen file is copied into the attachment folder and its
              links are updated. The originals stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-ui-sm">
            {files.map((file) => (
              <li key={file.absolutePath}>
                <label
                  className="flex cursor-pointer items-center gap-3"
                  title={file.absolutePath}
                >
                  <Checkbox
                    checked={selected.has(file.absolutePath)}
                    onCheckedChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked === true) next.add(file.absolutePath);
                        else next.delete(file.absolutePath);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {getFileName(file.absolutePath)}
                    <span className="ml-1.5 text-muted-foreground">
                      {getLocationLabel(file, vaultPath)}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isWorking || chosen.length === 0}
              onClick={(event) => {
                event.preventDefault();
                void importFiles();
              }}
            >
              {isWorking ? <Loader2Icon className="animate-spin" /> : null}
              Import {plural(chosen.length, "file")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
