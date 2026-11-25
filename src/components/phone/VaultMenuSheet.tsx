import { useEffect, useState } from "react";
import {
  CheckIcon,
  CloudIcon,
  FolderOpenIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { defaultVaultLocation, openVaultDialog } from "@/lib/commands/vault";
import { getParentFolder, isPathWithin, isSamePath } from "@/lib/drawing-files";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { folderName, openVault } from "@/lib/open-vault";
import { IS_ANDROID } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { useSyncStore } from "@/store/sync";
import { usePhoneNav } from "./nav";
import { syncStatusLabel, useSyncProblem } from "./SyncStrip";
import { useAppTrash } from "./trash";

/** The start of a path in the phone's shared storage, such as Documents. */
const SHARED_STORAGE = /^\/storage\/emulated\/\d+\//;

/**
 * Where a vault lives, as its row says it: in the app's own storage, or
 * the folder holding it.
 */
function vaultPlace(path: string, appStorage: string | null) {
  if (appStorage && isPathWithin(path, appStorage)) return "On this phone";
  // In the phone's shared storage, as its Files app names the folder.
  const shared = SHARED_STORAGE.exec(path);
  if (shared) return `In ${path.slice(shared[0].length)}`;
  return `In ${getParentFolder(path)}`;
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
  const trashCount = useAppTrash((s) => s.items.length);

  useEffect(() => {
    if (!open) return;
    void useAppTrash.getState().load();
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

  /** A folder in the phone's storage, picked and opened as a vault. */
  async function openFolder() {
    onOpenChange(false);
    const picked = await openVaultDialog();
    const path = picked && (await chooseVaultFolder(picked, "open"));
    if (path) await switchTo(path);
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
      {IS_ANDROID ? (
        <BottomSheetItem icon={<FolderOpenIcon />} onClick={() => void openFolder()}>
          Open a folder
        </BottomSheetItem>
      ) : null}
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
        icon={<TrashIcon />}
        onClick={() => replace({ kind: "trash" })}
        end={trashCount > 0 ? <span className="text-sm">{trashCount}</span> : null}
      >
        Trash
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
