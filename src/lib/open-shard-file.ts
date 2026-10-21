import { toast } from "sonner";
import { create } from "zustand";

import { importShard, scanVault } from "@/lib/commands";
import { isPathWithin } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { folderName, openVault } from "@/lib/open-vault";
import { useVaultStore } from "@/store";

/** A shard from outside the open vault, and the folder it's in. */
export interface OutsideShard {
  filePath: string;
  vaultPath: string;
}

/** The shard the import shard dialog asks about, if any. */
export const useOutsideShard = create<{ shard: OutsideShard | null }>(() => ({
  shard: null,
}));

async function switchVault(vaultPath: string) {
  try {
    await openVault(vaultPath);
    return true;
  } catch (error) {
    console.error("[Netherstone] Failed to open vault:", error);
    toast.error(`Couldn't open ${folderName(vaultPath)}`);
    return false;
  }
}

/**
 * Opens a .md file from anywhere on this device. A shard in the open vault
 * just opens. With no vault open, its folder opens as the vault. Otherwise
 * the import shard dialog asks whether to switch to its folder or copy it in.
 */
export async function openShardFile(filePath: string) {
  const { currentVaultPath } = useVaultStore.getState();

  if (currentVaultPath && isPathWithin(filePath, currentVaultPath)) {
    await openEditorFile(filePath);
    return;
  }

  const vaultPath = filePath.replace(/[\\/][^\\/]*$/, "");
  if (!currentVaultPath) {
    if (await switchVault(vaultPath)) await openEditorFile(filePath);
    return;
  }

  useOutsideShard.setState({ shard: { filePath, vaultPath } });
}

/** Copies the asked about shard into the open vault, then opens the copy. */
export async function importOutsideShard() {
  const { shard } = useOutsideShard.getState();
  const { currentVaultPath, setFileTree } = useVaultStore.getState();
  if (!shard || !currentVaultPath) return;

  try {
    const copiedPath = await importShard(shard.filePath, currentVaultPath);
    setFileTree(await scanVault(currentVaultPath));
    await openEditorFile(copiedPath);
  } catch (error) {
    console.error("[Netherstone] Failed to import shard:", error);
    toast.error(`Couldn't import ${folderName(shard.filePath)}`);
  } finally {
    closeOutsideShard();
  }
}

/** Opens the asked about shard's folder as the vault, then the shard. */
export async function openOutsideShardVault() {
  const { shard } = useOutsideShard.getState();
  if (!shard) return;

  closeOutsideShard();
  if (await switchVault(shard.vaultPath)) await openEditorFile(shard.filePath);
}

export function closeOutsideShard() {
  useOutsideShard.setState({ shard: null });
}
