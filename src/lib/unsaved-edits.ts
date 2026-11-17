import type { Descendant, SlateEditor } from "platejs";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  discardUnsavedEdits,
  keepUnsavedEdits,
  readUnsavedEdits,
} from "@/lib/commands/shards";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

/** A crashed editor's unsaved edits: Markdown, or its blocks when they don't serialize. */
type KeptEdits = { markdown: string } | { value: Descendant[] };

function openVault(): string {
  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (!vaultPath) throw new Error("No vault is open.");
  return vaultPath;
}

/**
 * Keeps the unsaved edits of an editor that crashed, beside the vault's
 * history and never over the shard. Run before the editor is torn down.
 */
export async function keepCrashedEdits(
  filePath: string,
  editor: SlateEditor,
): Promise<void> {
  const vaultPath = openVault();
  const value = editor.children;
  let kept: KeptEdits;
  try {
    const markdown = await serializeMarkdownInWorker(value, {
      filePath,
      requestKey: `unsaved-edits:${filePath}`,
      fallback: () => getSaveMarkdownContent(editor, "", { filePath }),
    });
    kept = { markdown };
  } catch (error) {
    console.error("[Netherstone] Unsaved edits kept as blocks:", error);
    kept = { value };
  }
  await keepUnsavedEdits(vaultPath, filePath, JSON.stringify(kept));
}

/**
 * Reopens the shard with its kept edits, unsaved, so the next save writes
 * them.
 */
export async function restoreCrashedEdits(filePath: string): Promise<void> {
  const copy = await readUnsavedEdits(openVault(), filePath);
  if (copy === null) throw new Error("No unsaved edits were kept.");
  const kept = JSON.parse(copy) as KeptEdits;
  const value =
    "markdown" in kept
      ? await resolveSessionValue(filePath, kept.markdown, null)
      : kept.value;
  await openEditorFile(filePath, value);
}

/** Deletes the shard's kept edits, as reloading its saved version does. */
export async function discardCrashedEdits(filePath: string): Promise<void> {
  await discardUnsavedEdits(openVault(), filePath);
}

/** Whether the shard has kept edits to restore. */
export async function hasCrashedEdits(filePath: string): Promise<boolean> {
  return (await readUnsavedEdits(openVault(), filePath)) !== null;
}

/**
 * After a save of the open shard: once a shard reopened with kept edits has
 * saved them, the copy goes.
 */
export function settleRestoredEdits(vaultPath: string, filePath: string) {
  const state = useEditorStore.getState();
  if (!state.opensUnsaved || state.currentFilePath !== filePath) return;
  useEditorStore.setState({ opensUnsaved: false });
  void discardUnsavedEdits(vaultPath, filePath).catch((error) =>
    console.error("[Netherstone] Couldn't delete restored edits:", error),
  );
}
