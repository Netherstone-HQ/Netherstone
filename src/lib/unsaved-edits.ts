import type { Descendant, SlateEditor } from "platejs";
import { toast } from "sonner";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  discardUnsavedEdits,
  keepUnsavedEdits,
  readUnsavedEdits,
} from "@/lib/commands/shards";
import { displayNameOf } from "@/lib/drawing-files";
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
async function restoreCrashedEdits(filePath: string): Promise<void> {
  const copy = await readUnsavedEdits(openVault(), filePath);
  if (copy === null) throw new Error("No unsaved edits were kept.");
  const kept = JSON.parse(copy) as KeptEdits;
  const value =
    "markdown" in kept
      ? await resolveSessionValue(filePath, kept.markdown, null)
      : kept.value;
  await openEditorFile(filePath, value);
}

/** Restores the shard's kept edits, and says so if they couldn't be. */
export function restoreCrashedEditsOrSay(filePath: string) {
  restoreCrashedEdits(filePath).catch((error) => {
    console.error("[Netherstone] Couldn't restore unsaved edits:", error);
    toast.error("Couldn't restore unsaved edits");
  });
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
 * Offers the open shard's kept edits, if it has any: to restore them, as the
 * crash screen does, or to discard them. Returns a cleanup that withdraws the
 * offer, for when another shard opens.
 */
export function offerCrashedEdits(): () => void {
  const { currentFilePath, editorSessionTick } = useEditorStore.getState();
  const vaultPath = useVaultStore.getState().currentVaultPath;
  // The offer follows the shard through a rename, but not to another shard
  // or vault.
  const stillOpen = () => {
    const state = useEditorStore.getState();
    return state.editorSessionTick === editorSessionTick &&
      useVaultStore.getState().currentVaultPath === vaultPath
      ? state.currentFilePath
      : null;
  };
  // One id per open: dismissing an earlier offer's id just before showing
  // this one would also take this one away.
  const toastId = `kept-edits:${editorSessionTick}`;
  let withdrawn = false;
  const withdraw = () => {
    withdrawn = true;
    toast.dismiss(toastId);
  };
  // A dirty shard stays open through a vault switch; the offer doesn't.
  const stopWatchingVault = useVaultStore.subscribe((state) => {
    if (state.currentVaultPath !== vaultPath) withdraw();
  });

  if (currentFilePath && vaultPath) {
    readUnsavedEdits(vaultPath, currentFilePath).then(
      (copy) => {
        if (copy === null || withdrawn) return;
        toast(
          `Unsaved edits to ${displayNameOf(currentFilePath)} were kept`,
          {
            id: toastId,
            duration: Infinity,
            // Text on top, buttons on a row of their own under it.
            classNames: {
              toast: "flex-wrap",
              content: "basis-full",
              cancelButton: "ml-auto",
            },
            action: {
              label: "Restore unsaved edits",
              onClick: () => {
                const filePath = stillOpen();
                if (filePath) restoreCrashedEditsOrSay(filePath);
              },
            },
            cancel: {
              label: "Discard",
              onClick: () => {
                const filePath = stillOpen();
                if (!filePath) return;
                discardCrashedEdits(filePath).catch((error) => {
                  console.error(
                    "[Netherstone] Couldn't discard unsaved edits:",
                    error,
                  );
                  toast.error("Couldn't discard unsaved edits");
                });
              },
            },
          },
        );
      },
      (error) =>
        console.error("[Netherstone] Couldn't look for unsaved edits:", error),
    );
  }

  return () => {
    stopWatchingVault();
    withdraw();
  };
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
