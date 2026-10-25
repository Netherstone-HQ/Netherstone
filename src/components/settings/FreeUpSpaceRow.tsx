import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  formatBytes,
  getAssetLabel,
} from "@/components/settings/attachment-format";
import { SettingRow } from "@/components/settings/settings-ui";
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
  freeUpSpace,
  listOldAttachments,
  type OldAttachment,
} from "@/lib/history";
import { useSyncStore } from "@/store/sync";

function sumBytes(files: OldAttachment[]) {
  return files.reduce((sum, file) => sum + file.sizeBytes, 0);
}

/**
 * Old versions of attachments kept in the history: deleted files and what
 * replaced files held before. Free up space removes the ones picked.
 */
export function FreeUpSpaceRow({ vaultPath }: { vaultPath: string }) {
  const isSynced = useSyncStore(
    (s) => s.vaultPath === vaultPath && s.record?.syncEnabled === true,
  );
  const [old, setOld] = useState<OldAttachment[] | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [isFreeing, setIsFreeing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listOldAttachments(vaultPath)
      .then((files) => {
        if (!cancelled) setOld(files);
      })
      .catch((error) => {
        console.error("[Netherstone] Couldn't list old versions:", error);
        if (!cancelled) setOld([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  const open = () => {
    setPicked(new Set(old?.map((file) => file.path)));
    setIsOpen(true);
  };

  const toggle = (path: string, checked: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const chosen = old?.filter((file) => picked.has(file.path)) ?? [];

  const free = async () => {
    setIsFreeing(true);
    try {
      // Changes from other devices come in the usual way first.
      if (isSynced) await useSyncStore.getState().sync(vaultPath);
      const bytes = await freeUpSpace(
        vaultPath,
        chosen.flatMap((file) => file.blobs),
      );
      toast.success(`Freed ${formatBytes(bytes)}`);
      setIsOpen(false);
      setOld(await listOldAttachments(vaultPath));
    } catch (error) {
      console.error("[Netherstone] Free up space failed:", error);
      toast.error("Couldn't free up space", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsFreeing(false);
    }
  };

  const total = old ? sumBytes(old) : 0;

  return (
    <SettingRow
      label="Old attachment versions"
      description={
        old === null
          ? undefined
          : old.length === 0
            ? "Nothing to free up."
            : `They take ${formatBytes(total)} in history.`
      }
    >
      <Button
        variant="outline"
        size="sm"
        disabled={!old || old.length === 0}
        onClick={open}
      >
        Free up space
      </Button>

      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isFreeing) setIsOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Free up {formatBytes(sumBytes(chosen))}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSynced
                ? "This removes the old versions you pick from history here, on GitHub and on your other devices."
                : "This removes the old versions you pick from history."}{" "}
              Files in your vault stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            aria-label="Old attachment versions"
            className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-ui-sm"
          >
            {old?.map((file) => (
              <li key={file.path} title={file.path}>
                <label className="flex items-center gap-3">
                  <Checkbox
                    checked={picked.has(file.path)}
                    disabled={isFreeing}
                    onCheckedChange={(checked) =>
                      toggle(file.path, checked === true)
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {getAssetLabel(file.path)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isFreeing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isFreeing || chosen.length === 0}
              onClick={(event) => {
                event.preventDefault();
                void free();
              }}
            >
              {isFreeing ? <Loader2Icon className="animate-spin" /> : null}
              Free up space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  );
}
