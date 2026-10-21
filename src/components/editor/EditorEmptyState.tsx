import { useState } from "react";
import { FolderInputIcon, ImportIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { openVaultDialog } from "@/lib/commands";
import { openImportDialog } from "@/lib/import";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { folderName, openVault } from "@/lib/open-vault";
import { useVaultStore } from "@/store";
import { NewShardDialog } from "@/components/vault/NewShardDialog";
import { NewVaultDialog } from "@/components/vault/NewVaultDialog";
import { NetherstoneMark } from "@/components/brand/NetherstoneMark";

export function EditorEmptyState() {
  const [isNewShardDialogOpen, setIsNewShardDialogOpen] = useState(false);
  const [isNewVaultOpen, setIsNewVaultOpen] = useState(false);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);

  async function handleOpenVault() {
    const picked = await openVaultDialog();
    const path = picked && (await chooseVaultFolder(picked, "open"));
    if (!path) return;
    try {
      await openVault(path);
    } catch (error) {
      console.error("[Netherstone] Failed to open vault:", error);
      toast.error(`Couldn't open ${folderName(path)}`);
    }
  }

  return (
    <>
      <Empty className="border-0 rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="opacity-80">
            <NetherstoneMark variant="mono" className="size-6" />
          </EmptyMedia>
          <EmptyTitle>
            {currentVaultPath ? "No shard open" : "No vault open"}
          </EmptyTitle>
        </EmptyHeader>
        <EmptyContent className="max-w-none flex-row items-center justify-center gap-2">
          {currentVaultPath ? (
            <>
              <Button onClick={() => setIsNewShardDialogOpen(true)}>
                <PlusIcon />
                New shard
              </Button>
              <Button
                variant="outline"
                onClick={() => openImportDialog(currentVaultPath)}
              >
                <ImportIcon />
                Import
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setIsNewVaultOpen(true)}>
                <PlusIcon />
                New vault
              </Button>
              <Button variant="outline" onClick={() => void handleOpenVault()}>
                <FolderInputIcon />
                Open vault
              </Button>
            </>
          )}
        </EmptyContent>
      </Empty>

      <NewShardDialog
        open={isNewShardDialogOpen}
        onOpenChange={setIsNewShardDialogOpen}
      />
      <NewVaultDialog open={isNewVaultOpen} onOpenChange={setIsNewVaultOpen} />
    </>
  );
}
