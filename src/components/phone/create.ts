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

/**
 * Makes the shard `name` in `folder` and opens it in place of the sheet
 * that asked for it. Returns what went wrong,
 * or null.
 */
export async function createShardIn(
  vaultPath: string,
  folder: string,
  name: string,
): Promise<string | null> {
  const title = name.replace(/\.md$/i, "");
  const filePath = resolveVaultRelativePath(`${title}.md`, folder);
  try {
    // Expecting an empty file refuses the save when a shard of that name
    // already has text, instead of writing over it.
    await saveMarkdownFile(filePath, `# ${title}\n\n`, { expectedContent: "" });
  } catch (error) {
    return isChangedOnDiskError(error)
      ? "A shard with this name is already here."
      : message(error);
  }
  await openFileScreen(filePath, true);
  await refreshTree(vaultPath);
  await indexVault(vaultPath);
  return null;
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
