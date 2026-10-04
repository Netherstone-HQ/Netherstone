import { fileExists, saveMarkdownFile, scanVault } from "@/lib/commands";
import { joinPath } from "@/lib/open-vault";
import { useVaultStore } from "@/store";
import startHere from "./start-here.md?raw";

const START_HERE_FILE = "Start here.md";

/**
 * Writes the Start here guide into the vault and returns its path. A guide
 * that is already there is kept as it is, so nobody's edits are replaced.
 */
export async function addStartHere(vaultPath: string): Promise<string> {
  const path = joinPath(vaultPath, START_HERE_FILE);
  if (!(await fileExists(path))) {
    await saveMarkdownFile(path, startHere);
    const vault = useVaultStore.getState();
    if (vault.currentVaultPath === vaultPath) {
      vault.setFileTree(await scanVault(vaultPath));
    }
  }
  return path;
}
