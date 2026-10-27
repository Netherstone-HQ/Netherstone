import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { formatBytes } from "@/components/settings/attachment-format";
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
  deleteGoneVaultHistory,
  listGoneVaultHistories,
  type GoneVaultHistory,
} from "@/lib/gone-vaults";

function sumBytes(histories: GoneVaultHistory[]) {
  return histories.reduce((sum, history) => sum + history.sizeBytes, 0);
}

/** The histories of vaults whose folder is gone, null while they load. */
export function useGoneVaultHistories() {
  const [histories, setHistories] = useState<GoneVaultHistory[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGoneVaultHistories()
      .then((found) => {
        if (!cancelled) setHistories(found);
      })
      .catch((error) => {
        console.error("[Netherstone] Couldn't list deleted vaults:", error);
        if (!cancelled) setHistories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return [histories, setHistories] as const;
}

/**
 * The history kept for vaults whose folder is gone. It stays until picked
 * here, then goes to the trash.
 */
export function GoneVaultsRow({
  histories,
  onChange,
}: {
  histories: GoneVaultHistory[];
  onChange: (histories: GoneVaultHistory[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const open = () => {
    setPicked(new Set());
    setIsOpen(true);
  };

  const toggle = (vaultId: string, checked: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(vaultId);
      else next.delete(vaultId);
      return next;
    });
  };

  const chosen = histories.filter((history) => picked.has(history.vaultId));

  const remove = async () => {
    setIsDeleting(true);
    let freed = 0;
    try {
      for (const history of chosen) {
        freed += await deleteGoneVaultHistory(history.vaultId);
      }
      toast.success(`Freed ${formatBytes(freed)}`);
      setIsOpen(false);
    } catch (error) {
      console.error("[Netherstone] Deleting a vault's history failed:", error);
      toast.error("Couldn't delete history", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsDeleting(false);
      onChange(await listGoneVaultHistories().catch(() => histories));
    }
  };

  return (
    <SettingRow
      label="Deleted vaults"
      description={`Their history takes ${formatBytes(sumBytes(histories))}`}
    >
      <Button variant="outline" size="sm" onClick={open}>
        Delete history
      </Button>

      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!isDeleting) setIsOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {chosen.length === 0
                ? "Delete history?"
                : `Delete ${formatBytes(sumBytes(chosen))} of history?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              The history of the vaults you pick goes to the trash. If you
              moved a vault, open it from its new place instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul
            aria-label="Deleted vaults"
            className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-ui-sm"
          >
            {histories.map((history) => (
              <li key={history.vaultId}>
                <label className="flex items-center gap-3">
                  <Checkbox
                    checked={picked.has(history.vaultId)}
                    disabled={isDeleting}
                    onCheckedChange={(checked) =>
                      toggle(history.vaultId, checked === true)
                    }
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{history.name}</span>
                    <span
                      className="truncate font-mono text-muted-foreground"
                      title={history.path}
                    >
                      {history.path}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(history.sizeBytes)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting || chosen.length === 0}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {isDeleting ? <Loader2Icon className="animate-spin" /> : null}
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  );
}
