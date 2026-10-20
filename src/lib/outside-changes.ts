import type { Descendant, SlateEditor } from "platejs";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { fileExists, readMarkdownFile, saveMarkdownFile } from "@/lib/commands";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { saveOutsideChangeVersion } from "@/lib/sync";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

/**
 * The open shard's blocks as they were when its text last matched the file
 * on disk (opened or saved). Unsaved edits are the blocks that differ.
 */
const savedValues = new WeakMap<SlateEditor, Descendant[]>();

/** Editors whose next change is an outside change, not an edit. */
const outsideChangeEditors = new WeakSet<SlateEditor>();

let queue: Promise<void> = Promise.resolve();

/** What a save returns when the shard changed outside the app. */
const CHANGED_ON_DISK = "The shard changed on disk";

export function isChangedOnDiskError(error: unknown): boolean {
  return String(error).includes(CHANGED_ON_DISK);
}

export function rememberSavedValue(editor: SlateEditor, value: Descendant[]) {
  savedValues.set(editor, value);
}

/**
 * True, once, for the change that showed an outside change in `editor`, so
 * it isn't counted as an edit.
 */
export function takeOutsideChange(editor: SlateEditor): boolean {
  return outsideChangeEditors.delete(editor);
}

/**
 * Shows what's on disk in the open shard when its file changed outside the
 * app, so the next save doesn't write over it. Only the blocks that changed
 * are replaced, keeping the scroll position and cursor. Unsaved edits to
 * other blocks are kept; if the same blocks changed on both sides, the user
 * is asked which version to keep (see `keepVersion`).
 */
export function reloadOpenShardIfChanged(): Promise<void> {
  queue = queue.then(reloadOpenShard).catch((error) => {
    console.error("[Netherstone] Couldn't reload the open shard:", error);
  });
  return queue;
}

async function reloadOpenShard() {
  await waitForSave();

  const { currentFilePath: filePath, openingFilePath } =
    useEditorStore.getState();
  // A shard being opened is read from disk anyway.
  if (!filePath || openingFilePath !== null) return;

  let markdown: string;
  try {
    markdown = await readMarkdownFile(filePath);
  } catch {
    // Gone; the watcher closes it.
    return;
  }

  const before = useEditorStore.getState();
  // Our own save, or nothing new.
  if (markdown === before.markdownContent) {
    // An outside change that was undone needs no choice any more.
    if (before.outsideChange?.path === filePath) before.setOutsideChange(null);
    return;
  }
  if (before.currentFilePath !== filePath) return;
  const editor = before.plateEditor;
  if (!editor) {
    // Still preparing from the old text; look again once it's on screen.
    reloadOnceMounted();
    return;
  }
  keepBothInHistory(filePath, before.markdownContent);

  const value = (await resolveSessionValue(
    filePath,
    markdown,
    null,
  )) as Descendant[];

  const state = useEditorStore.getState();
  if (
    state.currentFilePath !== filePath ||
    state.plateEditor !== editor ||
    state.isSaving
  ) {
    // Something else replaced or saved the shard meanwhile; look again.
    void reloadOpenShardIfChanged();
    return;
  }

  if (!state.isDirty) {
    showOutsideValue(editor, value);
    state.setMarkdownContent(markdown);
    rememberSavedValue(editor, editor.children);
    void upsertAstCache({ filePath, markdown, plateValue: value }).catch(
      (error) => console.error("[Netherstone] AST cache refresh failed:", error),
    );
    return;
  }

  const saved = savedValues.get(editor);
  const savedFromDisk = saved
    ? ((await resolveSessionValue(
        filePath,
        state.markdownContent,
        null,
      )) as Descendant[])
    : null;

  if (useEditorStore.getState().plateEditor !== editor) return;

  if (saved && savedFromDisk && mergeOutsideValue(editor, saved, savedFromDisk, value)) {
    // The merged text is saved like an edit.
    state.setMarkdownContent(markdown);
    state.bumpEditTick();
    return;
  }

  const mine = await serializeEditor(editor, filePath);
  if (useEditorStore.getState().plateEditor !== editor) return;
  state.setOutsideChange({ path: filePath, mine, outside: markdown });
}

export type KeptVersion = "mine" | "outside" | "both";

/**
 * Settles an outside change to the part being edited. "both" keeps the
 * user's version in the shard and saves the outside one next to it.
 */
export async function keepVersion(choice: KeptVersion) {
  const state = useEditorStore.getState();
  const { outsideChange: change, plateEditor: editor } = state;
  if (!change || !editor || state.currentFilePath !== change.path) return;

  if (choice === "outside") {
    const value = (await resolveSessionValue(
      change.path,
      change.outside,
      null,
    )) as Descendant[];
    if (useEditorStore.getState().plateEditor !== editor) return;
    showOutsideValue(editor, value);
    rememberSavedValue(editor, editor.children);
    state.setMarkdownContent(change.outside);
    state.setIsDirty(false);
    state.setOutsideChange(null);
    return;
  }

  if (choice === "both") {
    await saveMarkdownFile(await freeCopyPath(change.path), change.outside);
  }

  // The edits are saved over the outside version.
  state.setMarkdownContent(change.outside);
  state.setOutsideChange(null);
  state.bumpEditTick();
}

function serializeEditor(editor: SlateEditor, filePath: string) {
  const fallback = useEditorStore.getState().markdownContent;
  return serializeMarkdownInWorker(editor.children, {
    filePath,
    requestKey: `outside-change:${filePath}`,
    fallback: () => getSaveMarkdownContent(editor, fallback, { filePath }),
  });
}

/**
 * Saves the text the app last saved and the outside change as versions, so
 * whichever is kept, the other can be restored. Not awaited: it can wait on
 * a sync, and the shard shouldn't.
 */
function keepBothInHistory(filePath: string, previous: string) {
  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (!vaultPath) return;
  saveOutsideChangeVersion(vaultPath, filePath, previous).catch((error) =>
    console.error("[Netherstone] Couldn't save versions of the outside change:", error),
  );
}

function reloadOnceMounted() {
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (state.currentFilePath !== previous.currentFilePath) unsubscribe();
    else if (state.plateEditor) {
      unsubscribe();
      void reloadOpenShardIfChanged();
    }
  });
}

function waitForSave(): Promise<void> {
  if (!useEditorStore.getState().isSaving) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      if (state.isSaving) return;
      unsubscribe();
      resolve();
    });
  });
}

type ChangedRange = {
  /** First block that differs. */
  start: number;
  /** End of the differing blocks in the first value. */
  end: number;
  /** End of the differing blocks in the second value. */
  nextEnd: number;
};

/**
 * The run of top-level blocks that differs between two values, after the
 * blocks they share at the start and end. Null when they're the same.
 */
export function findChangedBlocks(
  current: readonly unknown[],
  next: readonly unknown[],
  same: (a: unknown, b: unknown) => boolean = isSameNode,
): ChangedRange | null {
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && same(current[start], next[start])) start += 1;

  let end = current.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && same(current[end - 1], next[nextEnd - 1])) {
    end -= 1;
    nextEnd -= 1;
  }

  if (start === end && start === nextEnd) return null;
  return { start, end, nextEnd };
}

/** Deep equality for Plate nodes, ignoring generated block ids. */
export function isSameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isSameNode(item, b[index]));
  }
  if (Array.isArray(b)) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => key !== "id");
  const bKeys = Object.keys(bRecord).filter((key) => key !== "id");
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => key in bRecord && isSameNode(aRecord[key], bRecord[key]),
  );
}

/** Replaces the blocks of `editor` that differ from `value`. */
export function showOutsideValue(editor: SlateEditor, value: Descendant[]) {
  const range = findChangedBlocks(editor.children, value);
  if (!range) return;
  replaceBlocks(editor, range.start, range.end, value.slice(range.start, range.nextEnd));
}

/**
 * Applies the outside change (`saved` → `outside`) to `editor` around its
 * unsaved edits (`saved` → `editor.children`). `savedFromDisk` is the saved
 * text read the same way as `outside`, so unchanged blocks compare equal.
 * Returns false, changing nothing, when both changed the same blocks.
 */
export function mergeOutsideValue(
  editor: SlateEditor,
  saved: Descendant[],
  savedFromDisk: Descendant[],
  outside: Descendant[],
): boolean {
  // The two reads of the saved text line up block for block, apart from
  // blocks the editor added at the end (an empty last paragraph).
  if (
    saved.length < savedFromDisk.length ||
    !savedFromDisk.every((node, index) => isSameNode(node, saved[index]))
  ) {
    return false;
  }

  const outsideRange = findChangedBlocks(savedFromDisk, outside);
  if (!outsideRange) return true;

  // Unchanged blocks keep their objects, so edits show as new objects.
  const editRange = findChangedBlocks(saved, editor.children, (a, b) => a === b);
  if (!editRange) {
    showOutsideValue(editor, outside);
    return true;
  }

  const blocks = outside.slice(outsideRange.start, outsideRange.nextEnd);
  if (outsideRange.end <= editRange.start) {
    replaceBlocks(editor, outsideRange.start, outsideRange.end, blocks);
    return true;
  }
  if (outsideRange.start >= editRange.end) {
    // Edits before it moved the blocks after them.
    const shift = editRange.nextEnd - editRange.end;
    replaceBlocks(
      editor,
      outsideRange.start + shift,
      outsideRange.end + shift,
      blocks,
    );
    return true;
  }
  return false;
}

function replaceBlocks(
  editor: SlateEditor,
  start: number,
  end: number,
  blocks: Descendant[],
) {
  outsideChangeEditors.add(editor);
  editor.tf.withoutSaving(() => {
    editor.tf.withoutNormalizing(() => {
      for (let index = end - 1; index >= start; index -= 1) {
        editor.tf.apply({
          type: "remove_node",
          path: [index],
          node: editor.children[index],
        });
      }
      blocks.forEach((node, offset) => {
        editor.tf.apply({ type: "insert_node", path: [start + offset], node });
      });
    });
  });
  // Undo steps from before can't apply to the new text.
  editor.history.undos = [];
  editor.history.redos = [];
}

/** `Note.md` → `Note (Changed outside).md`, numbered if that name is taken. */
export async function freeCopyPath(filePath: string) {
  const base = filePath.replace(/\.md$/i, "");
  for (let n = 1; ; n += 1) {
    const label = n === 1 ? "Changed outside" : `Changed outside ${n}`;
    const path = `${base} (${label}).md`;
    if (!(await fileExists(path))) return path;
  }
}
