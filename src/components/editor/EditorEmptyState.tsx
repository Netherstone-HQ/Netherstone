import { useState } from "react";
import { FileIcon, FolderOpenIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { openShardDialog, openVaultDialog, scanVault } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { useVaultStore } from "@/store";
import { NewShardDialog } from "@/components/vault/NewShardDialog";
import { NetherstoneMark } from "@/components/brand/NetherstoneMark";

export function EditorEmptyState() {
  const [isNewShardDialogOpen, setIsNewShardDialogOpen] = useState(false);
  const {
    currentVaultPath,
    setCurrentVaultPath,
    setFileTree,
    setVaultLoading,
  } = useVaultStore();

  const hasVault = currentVaultPath !== null;

  async function switchVault(vaultPath: string) {
    setCurrentVaultPath(vaultPath);
    setVaultLoading(true);
    try {
      const tree = await scanVault(vaultPath);
      setFileTree(tree);
    } catch (err) {
      console.error("[Netherstone] Failed to scan vault:", err);
    } finally {
      setVaultLoading(false);
    }
  }

  async function handleOpenVault() {
    const path = await openVaultDialog();
    if (!path) return;
    await switchVault(path);
  }

  async function handleOpenShard() {
    const result = await openShardDialog();
    if (!result) return;

    const { filePath, vaultPath } = result;

    const norm = (p: string) => p.replace(/\\/g, "/");
    const isInCurrentVault =
      currentVaultPath !== null &&
      norm(filePath).startsWith(norm(currentVaultPath) + "/");

    if (!isInCurrentVault) {
      await switchVault(vaultPath);
    }

    try {
      await openEditorFile(filePath);
    } catch (error) {
      console.error("Failed to load file:", error);
    }
  }

  return (
    <>
      <Empty className="border-0 rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="opacity-80">
            <NetherstoneMark variant="mono" className="size-6" />
          </EmptyMedia>
          <EmptyTitle>No shard open</EmptyTitle>
          <EmptyDescription>
            {hasVault
              ? "Create a new shard or open an existing one to get started."
              : "Open a vault or shard to get started."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-none flex-row items-center justify-center gap-2">
          {hasVault ? (
            <>
              <Button onClick={() => setIsNewShardDialogOpen(true)}>
                <PlusIcon className="size-4" />
                New Shard
              </Button>
              <Button variant="outline" onClick={() => void handleOpenShard()}>
                <FileIcon className="size-4" />
                Open Shard
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => void handleOpenVault()}>
                <FolderOpenIcon className="size-4" />
                Open Vault
              </Button>
              <Button variant="outline" onClick={() => void handleOpenShard()}>
                <FileIcon className="size-4" />
                Open Shard
              </Button>
            </>
          )}
        </EmptyContent>
      </Empty>

      <NewShardDialog
        open={isNewShardDialogOpen}
        onOpenChange={setIsNewShardDialogOpen}
      />
    </>
  );
}
