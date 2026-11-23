import { toast } from "sonner";
import { resolveVaultRelativePath } from "@/lib/drawing-files";
import { createDrawing } from "@/lib/open-vault-file";
import { createFolder, saveMarkdownFile } from "@/lib/commands/shards";
import {
  createEmptyVault,
  vaultErrorText,
} from "@/components/onboarding/VaultStep";
import { defaultVaultLocation, scanVault } from "@/lib/commands/vault";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { joinPath, openVault } from "@/lib/open-vault";
import { indexVault } from "@/lib/refresh-vault";
import { useVaultStore } from "@/store";
import { isChangedOnDiskError } from "@/lib/outside-changes";
import { openFileScreen } from "./open-file";
import { usePhoneNav } from "./nav";

async function refreshTree(vaultPath: string) {
  useVaultStore.getState().setFileTree(await scanVault(vaultPath));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** What a new shard is called until it's renamed. */
const NEW_SHARD_NAME = "Untitled";

/**
 * Makes an empty shard in `folder`, called "Untitled", or "Untitled 2" and
 * so on when that's taken, and opens it to type in.
 */
export async function createUntitledShard(vaultPath: string, folder: string) {
  for (let count = 1; ; count++) {
    const name = count === 1 ? NEW_SHARD_NAME : `${NEW_SHARD_NAME} ${count}`;
    const filePath = resolveVaultRelativePath(`${name}.md`, folder);
    try {
      // Expecting an empty file refuses the save when a shard of that name
      // already has text, instead of writing over it.
      await saveMarkdownFile(filePath, "", { expectedContent: "" });
    } catch (error) {
      if (isChangedOnDiskError(error)) continue;
      toast.error("Couldn't make the shard", { description: message(error) });
      return;
    }
    await openFileScreen(filePath);
    await refreshTree(vaultPath);
    await indexVault(vaultPath);
    return;
  }
}

/** Makes the folder `name` in `parent` and opens it in place of the sheet. */
export async function createFolderIn(
  vaultPath: string,
  parent: string,
  name: string,
): Promise<string | null> {
  try {
    const path = await createFolder(parent, name);
    await refreshTree(vaultPath);
    usePhoneNav.getState().replace({ kind: "folder", path });
    return null;
  } catch (error) {
    return message(error);
  }
}

/** Makes an untitled drawing in `folder` and opens it. */
export async function createDrawingIn(vaultPath: string, folder: string) {
  await createDrawing(vaultPath, folder);
  usePhoneNav.getState().push({ kind: "file" });
}

/**
 * Makes the vault `name` on this phone, switches to it and opens its Start
 * here guide in place of the sheet that asked. Returns what went wrong, or
 * null.
 */
export async function createVaultNamed(name: string): Promise<string | null> {
  try {
    const location = await defaultVaultLocation();
    if (!location) return "Couldn't find where this phone keeps vaults.";
    const target = joinPath(location, name.trim());
    const chosen = await chooseVaultFolder(target, "create");
    if (chosen !== target) {
      // An existing vault there opens instead; nothing picked stays put.
      if (!chosen) return null;
      await openVault(chosen);
      usePhoneNav.getState().closeFrom("new-vault");
      return null;
    }
    const { startHerePath } = await createEmptyVault(location, name);
    if (startHerePath) await openFileScreen(startHerePath, true);
    else usePhoneNav.getState().closeFrom("new-vault");
    return null;
  } catch (error) {
    return vaultErrorText(error);
  }
}
