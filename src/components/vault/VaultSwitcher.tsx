import { useState } from "react";
import { FileIcon, FolderOpenIcon } from "@phosphor-icons/react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  importShard,
  openShardDialog,
  openVaultDialog,
  scanVault,
  type ShardDialogResult,
} from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { switchVault } from "@/lib/switch-vault";
import { useVaultStore } from "@/store";
import { ImportShardDialog } from "./ImportShardDialog";

export function VaultSwitcher() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const [pendingShard, setPendingShard] = useState<ShardDialogResult | null>(
    null,
  );

  async function openShardWithContent(filePath: string) {
    await openEditorFile(filePath);
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

    if (isInCurrentVault) {
      await openShardWithContent(filePath);
      return;
    }

    // File is outside the current vault — ask the user what to do.
    if (currentVaultPath === null) {
      // No vault open yet: just switch without prompting.
      await switchVault(vaultPath);
      await openShardWithContent(filePath);
      return;
    }

    setPendingShard(result);
  }

  async function handleImport() {
    if (!pendingShard || !currentVaultPath) return;
    try {
      const copiedPath = await importShard(
        pendingShard.filePath,
        currentVaultPath,
      );
      // Rescan so the imported shard appears in the tree.
      const tree = await scanVault(currentVaultPath);
      useVaultStore.getState().setFileTree(tree);
      await openShardWithContent(copiedPath);
    } catch (err) {
      console.error("[Netherstone] Failed to import shard:", err);
    } finally {
      setPendingShard(null);
    }
  }

  async function handleOpenItsVault() {
    if (!pendingShard) return;
    await switchVault(pendingShard.vaultPath);
    await openShardWithContent(pendingShard.filePath);
    setPendingShard(null);
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Vault</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Open Vault" onClick={handleOpenVault}>
                <FolderOpenIcon />
                <span>Open Vault</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Open Shard" onClick={handleOpenShard}>
                <FileIcon />
                <span>Open Shard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <ImportShardDialog
        shard={pendingShard}
        onImport={handleImport}
        onOpenVault={handleOpenItsVault}
        onClose={() => setPendingShard(null)}
      />
    </>
  );
}
