import { useEffect, useState } from "react";
import { CheckIcon, CloudIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { defaultVaultLocation } from "@/lib/commands/vault";
import { isPathWithin, isSamePath } from "@/lib/drawing-files";
import { folderName, openVault } from "@/lib/open-vault";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { useSyncStore } from "@/store/sync";
import { usePhoneNav } from "./nav";
import { syncStatusLabel, useSyncProblem } from "./SyncStrip";

/**
 * Where a vault lives, as its row says it: in the app's own storage, or
 * the folder holding it.
 */
export function vaultPlace(path: string, appStorage: string | null) {
  if (appStorage && isPathWithin(path, appStorage)) return "On this phone";
  const parent = path.replace(/[\\/][^\\/]*[\\/]?$/, "");
  return `In ${parent}`;
}

/** The vaults to switch between, then sync and Settings. */
export function VaultMenuSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = useVaultStore((s) => s.currentVaultPath);
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const replace = usePhoneNav((s) => s.replace);
  const syncOn = useSyncStore(
    (s) => s.vaultPath === current && !!s.record?.syncEnabled,
  );
  const problem = useSyncProblem(current);
  const [appStorage, setAppStorage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void defaultVaultLocation()
      .then(setAppStorage)
      .catch(() => {});
  }, [open]);

  async function switchTo(path: string) {
    onOpenChange(false);
    if (current && isSamePath(path, current)) return;
    try {
      await openVault(path);
    } catch (error) {
      console.error("[Netherstone] Failed to open vault:", error);
      toast.error(`Couldn't open ${folderName(path)}`);
    }
  }

  const status = syncStatusLabel(syncOn, problem);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Vaults">
      <ul>
        {recentVaults.map((path) => {
          const isCurrent = !!current && isSamePath(path, current);
          return (
            <li key={path}>
              <button
                type="button"
                aria-current={isCurrent || undefined}
                className="flex h-16 w-full items-center gap-4 px-4 text-left outline-none active:bg-accent"
                onClick={() => void switchTo(path)}
              >
                <span className="flex size-5 shrink-0 items-center text-brand">
                  {isCurrent ? <CheckIcon className="size-5" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {folderName(path)}
                  </span>
                  <span className="truncate text-sm leading-[18px] text-muted-foreground">
                    {vaultPlace(path, appStorage)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <BottomSheetItem
        icon={<PlusIcon />}
        onClick={() => replace({ kind: "new-vault" })}
      >
        New vault
      </BottomSheetItem>
      <BottomSheetSeparator />
      <BottomSheetItem
        icon={<CloudIcon />}
        onClick={() => replace({ kind: "settings", category: "sync" })}
        end={
          <span className="flex items-center gap-2 text-sm">
            {syncOn ? (
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full",
                  problem ? "bg-destructive" : "bg-brand",
                  problem === "offline" && "bg-muted-foreground",
                )}
              />
            ) : null}
            {status}
          </span>
        }
      >
        Sync
      </BottomSheetItem>
      <BottomSheetItem
        icon={<SettingsIcon />}
        onClick={() => replace({ kind: "settings", category: null })}
      >
        Settings
      </BottomSheetItem>
    </BottomSheet>
  );
}
