import { toast } from "sonner";

import { revealHeading } from "@/components/editor/lib/link-reveal";
import { getVaultFileDisplayName, isSamePath } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

/** A shard an answer cites: a vault-relative path and maybe a section. */
export interface Citation {
  path: string;
  section: string | null;
}

function inVault(vault: string, path: string) {
  const separator = vault.includes("\\") ? "\\" : "/";
  return (
    vault.replace(/[\\/]+$/, "") + separator + path.split("/").join(separator)
  );
}

/** Opens the shard an answer cites, at the section it cites. */
export async function openCitation(citation: Citation) {
  const vault = useVaultStore.getState().currentVaultPath;
  if (!vault) return;
  const path = inVault(vault, citation.path);
  const { setPendingLinkReveal } = useEditorStore.getState();
  if (citation.section) {
    setPendingLinkReveal({ path, heading: citation.section });
  }
  try {
    await openVaultFile(path);
  } catch {
    setPendingLinkReveal(null);
    const name = citation.path.split("/").pop() ?? citation.path;
    toast.error(`Couldn't open ${getVaultFileDisplayName(name)}`);
    return;
  }
  // The shard was already open, so it isn't drawn again to take the reveal.
  const { pendingLinkReveal, plateEditor, currentFilePath } =
    useEditorStore.getState();
  if (
    citation.section &&
    pendingLinkReveal &&
    "heading" in pendingLinkReveal &&
    plateEditor &&
    currentFilePath &&
    isSamePath(currentFilePath, path)
  ) {
    setPendingLinkReveal(null);
    revealHeading(plateEditor, citation.section);
  }
}
