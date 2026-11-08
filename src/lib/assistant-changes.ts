import type { Descendant } from "platejs";
import { toast } from "sonner";

import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  type ChatChange,
  type MadeChange,
  applyChange,
  discardChange,
  getChat,
  undoChange,
} from "@/lib/commands/assistant";
import { fillDrawingPictures } from "@/lib/drawing-exports";
import { toVaultRelativePath } from "@/lib/drawing-files";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import {
  reloadOpenShardIfChanged,
  rememberSavedValue,
  showWrittenValue,
} from "@/lib/outside-changes";
import { suppressVaultChangePath } from "@/lib/vault-change-suppression";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { useVaultStore } from "@/store/vault";

const store = useAssistantStore;

/** The open shard, vault-relative, when one is open. */
export function openShardPath(
  vault: string | null,
  openPath: string | null,
): string | null {
  return vault && openPath && /\.md$/i.test(openPath)
    ? toVaultRelativePath(openPath, vault)
    : null;
}

/** The change shown in the open shard: the chat's latest pending one to it. */
function previewedChange(
  changes: ChatChange[],
  openShard: string | null,
): ChatChange | null {
  if (!openShard) return null;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (
      change.state === "pending" &&
      change.kind === "shard" &&
      change.path === openShard
    ) {
      return change;
    }
  }
  return null;
}

/** The pending change previewed in the open shard while the panel is shown. */
export function usePreviewedChange(): ChatChange | null {
  const shown = store((s) => s.isOpen && s.enabled === true);
  const changes = store((s) => s.changes);
  const historyOpen = useHistoryStore((s) => s.openIn === "notes");
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const setAside = store((s) => s.previewSetAside);
  if (!shown || historyOpen) return null;
  const change = previewedChange(changes, openShardPath(vault, openPath));
  return change?.id === setAside ? null : change;
}

/** Back to editing the open shard, the change waiting in its card. */
export function setPreviewAside(change: ChatChange) {
  store.setState({ previewSetAside: change.id });
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the chat's changes again, as Apply, Undo or Discard left them. */
async function reloadChanges(chat: string) {
  const view = await getChat(chat);
  if (store.getState().chat?.id === chat) {
    store.setState({ changes: view.changes });
  }
}

/**
 * Runs `write` on the change's file. When that's the open shard, the
 * editor's edits are saved first and the written text shows in the editor,
 * as one step its Undo takes back, so it isn't taken for an outside change.
 */
async function writeChange(
  change: ChatChange,
  write: (expected: string | null) => Promise<MadeChange>,
): Promise<boolean> {
  const vault = useVaultStore.getState().currentVaultPath;
  if (!vault) return false;
  await flushPendingAutosave();
  const state = useEditorStore.getState();
  const filePath = state.currentFilePath;
  // Only an edit keeps the shard where it is, to show it in the editor.
  const isOpen =
    change.kind === "shard" &&
    filePath !== null &&
    openShardPath(vault, filePath) === change.path;
  if (!isOpen || !filePath) {
    await write(null);
    return true;
  }
  if (state.isDirty || state.outsideChange) {
    throw new Error("Your latest changes aren't saved yet. Try again in a moment.");
  }

  // Outside-change checks wait while this is set, then find the written
  // text already on screen.
  const shown = state.plateEditor?.children;
  let typed = false;
  let made: MadeChange;
  state.setIsSaving(true);
  try {
    suppressVaultChangePath(filePath);
    made = await write(state.markdownContent);
    // Typed while it was written: what's typed stays, and the written text
    // comes in around it as an outside change does.
    typed = useEditorStore.getState().plateEditor?.children !== shown;
    if (made.content !== null && !typed) await showWritten(filePath, made.content);
  } finally {
    useEditorStore.getState().setIsSaving(false);
  }
  if (typed) await reloadOpenShardIfChanged();
  // A drawing the change shows gets its picture now, as on opening the shard.
  if (made.content !== null) {
    await fillDrawingPictures(filePath, made.content, vault);
  }
  return true;
}

async function showWritten(filePath: string, markdown: string) {
  const value = (await resolveSessionValue(
    filePath,
    markdown,
    null,
  )) as Descendant[];
  const state = useEditorStore.getState();
  const editor = state.plateEditor;
  if (!editor || state.currentFilePath !== filePath) return;
  showWrittenValue(editor, value);
  rememberSavedValue(editor, editor.children);
  state.setMarkdownContent(markdown);
  void upsertAstCache({ filePath, markdown, plateValue: value }).catch(
    (error) => console.error("[Netherstone] AST cache refresh failed:", error),
  );
}

/** Marks a change or memory item as being worked on while `work` runs. */
export async function busy(item: { id: string }, work: () => Promise<void>) {
  const { busyChanges } = store.getState();
  if (busyChanges.includes(item.id)) return;
  store.setState({ busyChanges: [...busyChanges, item.id] });
  try {
    await work();
  } finally {
    store.setState({
      busyChanges: store.getState().busyChanges.filter((id) => id !== item.id),
    });
  }
}

/** Makes a pending change, through the editor when it's the open shard. */
export function applyAssistantChange(change: ChatChange) {
  const chat = store.getState().chat?.id;
  if (!chat) return Promise.resolve();
  return busy(change, async () => {
    try {
      await writeChange(change, (expected) => applyChange(change.id, expected));
    } catch (error) {
      console.error("[Netherstone] Couldn't apply a change:", error);
      toast.error("Couldn't apply the change", { description: errorText(error) });
    }
    useHistoryStore.getState().versionsChanged();
    await reloadChanges(chat).catch(() => {});
  });
}

/** Takes an applied change back, through the editor when it's the open shard. */
export function undoAssistantChange(change: ChatChange) {
  const chat = store.getState().chat?.id;
  if (!chat) return Promise.resolve();
  return busy(change, async () => {
    try {
      await writeChange(change, () => undoChange(change.id));
    } catch (error) {
      console.error("[Netherstone] Couldn't undo a change:", error);
      toast.error("Couldn't undo the change", { description: errorText(error) });
    }
    useHistoryStore.getState().versionsChanged();
    await reloadChanges(chat).catch(() => {});
  });
}

/** Drops a pending change without writing anything. */
export function discardAssistantChange(change: ChatChange) {
  return busy(change, async () => {
    try {
      await discardChange(change.id);
    } catch (error) {
      // The card stays, as the change is still pending.
      console.error("[Netherstone] Couldn't discard a change:", error);
      toast.error("Couldn't discard the change", { description: errorText(error) });
      return;
    }
    // It stays in the chat, marked as discarded.
    store.setState({
      changes: store
        .getState()
        .changes.map((c) =>
          c.id === change.id ? { ...c, state: "discarded" as const } : c,
        ),
    });
  });
}

/**
 * Adds an answer's text to the open shard, under the block the cursor is in
 * or at the end, as an edit of the user's own that Undo takes back.
 */
export async function addAnswerToShard(markdown: string): Promise<boolean> {
  const { plateEditor: editor, currentFilePath: filePath } =
    useEditorStore.getState();
  if (!editor || !filePath || !markdown.trim()) return false;
  const value = (await resolveSessionValue(
    filePath,
    markdown,
    null,
  )) as Descendant[];
  const state = useEditorStore.getState();
  if (state.plateEditor !== editor || state.currentFilePath !== filePath) {
    return false;
  }
  const at = editor.selection
    ? editor.selection.focus.path[0] + 1
    : editor.children.length;
  editor.tf.withNewBatch(() => {
    editor.tf.insertNodes(value, { at: [at] });
  });
  return true;
}
