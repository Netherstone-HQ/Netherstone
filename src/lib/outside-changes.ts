import {
  ElementApi,
  NodeApi,
  TextApi,
  type Descendant,
  type SlateEditor,
} from "platejs";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  diffBlocks,
  isSameNode,
  mergeHunks,
  nextBlocks,
  rebaseHistory,
} from "@/lib/block-merge";
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

/**
 * The open shard's text as it was last read from disk (opened, or changed
 * outside the app). What the app saved since is what the user wrote.
 */
const readTexts = new WeakMap<SlateEditor, string>();

/** Editors whose next change is an outside change, not an edit. */
const outsideChangeEditors = new WeakSet<SlateEditor>();

let queue: Promise<void> = Promise.resolve();

/** What a save returns when the shard changed outside the app. */
const CHANGED_ON_DISK = "The shard changed on disk";

export function isChangedOnDiskError(error: unknown): boolean {
  return String(error).includes(CHANGED_ON_DISK);
}

/**
 * Notes `value` as the open shard's saved blocks. The first call, as the
 * shard opens, also notes the text it was read with.
 */
export function rememberSavedValue(editor: SlateEditor, value: Descendant[]) {
  savedValues.set(editor, value);
  if (!readTexts.has(editor)) {
    readTexts.set(editor, useEditorStore.getState().markdownContent);
  }
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
 * other blocks are kept. If the same blocks changed on both sides, or the
 * outside save drops what the user wrote since the shard was read (an app
 * that still had the old text saved it), the user is asked which version to
 * keep (see `keepVersion`).
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

  const mine = state.isDirty
    ? await serializeEditor(editor, filePath)
    : state.markdownContent;
  if (useEditorStore.getState().plateEditor !== editor) return;

  // Both sides made the same change, as a move does to the links to it.
  if (mine === markdown) {
    state.setMarkdownContent(markdown);
    state.setIsDirty(false);
    state.setOutsideChange(null);
    rememberSavedValue(editor, editor.children);
    readTexts.set(editor, markdown);
    return;
  }

  // Saved edits only: unsaved ones are merged below.
  const read = readTexts.get(editor);
  const saved = state.markdownContent;
  if (read !== undefined && read !== saved) {
    const [readValue, savedValue] = (await Promise.all([
      resolveSessionValue(filePath, read, null),
      resolveSessionValue(filePath, saved, null),
    ])) as Descendant[][];
    if (useEditorStore.getState().plateEditor !== editor) return;
    if (dropsWrittenText(readValue, savedValue, value)) {
      state.setOutsideChange({ path: filePath, mine, outside: markdown });
      return;
    }
  }

  if (!state.isDirty) {
    showOutsideValue(editor, value);
    state.setMarkdownContent(markdown);
    rememberSavedValue(editor, editor.children);
    readTexts.set(editor, markdown);
    void upsertAstCache({ filePath, markdown, plateValue: value }).catch(
      (error) => console.error("[Netherstone] AST cache refresh failed:", error),
    );
    return;
  }

  const savedBlocks = savedValues.get(editor);
  const savedFromDisk = savedBlocks
    ? ((await resolveSessionValue(filePath, saved, null)) as Descendant[])
    : null;

  if (useEditorStore.getState().plateEditor !== editor) return;

  const merged =
    savedBlocks && savedFromDisk
      ? mergeOutsideValue(editor, savedBlocks, savedFromDisk, value)
      : null;
  if (merged) {
    // The merged text is saved like an edit.
    rememberSavedValue(editor, merged);
    state.setMarkdownContent(markdown);
    readTexts.set(editor, markdown);
    state.bumpEditTick();
    return;
  }

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
    readTexts.set(editor, change.outside);
    state.setMarkdownContent(change.outside);
    state.setIsDirty(false);
    state.setOutsideChange(null);
    return;
  }

  if (choice === "both") {
    await saveMarkdownFile(await freeCopyPath(change.path), change.outside);
  }

  // Your version is saved over the outside one, even if it was saved before.
  readTexts.set(editor, change.outside);
  state.setMarkdownContent(change.outside);
  state.setIsDirty(true);
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

/**
 * True when `outside` loses what the app saved since the shard was read
 * (`read` → `saved`): a block written here isn't in it, or a block deleted
 * here is back. Empty lines don't count.
 */
export function dropsWrittenText(
  read: Descendant[],
  saved: Descendant[],
  outside: Descendant[],
): boolean {
  const hunks = diffBlocks(read, saved);
  if (!hunks.length) return false;

  const has = (blocks: Descendant[], node: Descendant) =>
    blocks.some((block) => isSameNode(block, node));
  const counts = (node: Descendant) => !isEmptyLine(node);

  const written = hunks.flatMap((hunk) => nextBlocks(saved, hunk)).filter(counts);
  const deleted = hunks
    .flatMap((hunk) => read.slice(hunk.start, hunk.end))
    .filter(counts);
  return (
    written.some((node) => !has(outside, node)) ||
    deleted.some((node) => has(outside, node) && !has(saved, node))
  );
}

function isEmptyLine(node: Descendant) {
  return (
    ElementApi.isElement(node) &&
    node.type === "p" &&
    NodeApi.string(node).trim() === "" &&
    node.children.every((child) => TextApi.isText(child))
  );
}

/** Replaces the blocks of `editor` that differ from `value`. */
export function showOutsideValue(editor: SlateEditor, value: Descendant[]) {
  replaceBlocks(
    editor,
    diffBlocks(editor.children, value).map((hunk) => ({
      start: hunk.start,
      end: hunk.end,
      blocks: nextBlocks(value, hunk),
    })),
  );
}

/**
 * Applies the outside change (`saved` → `outside`) to `editor` around its
 * unsaved edits (`saved` → `editor.children`), block run by block run.
 * `savedFromDisk` is the saved text read the same way as `outside`, so
 * unchanged blocks compare equal. Returns the saved blocks with the outside
 * change in, to compare the next edits with, or null, changing nothing, when
 * both changed the same blocks.
 */
export function mergeOutsideValue(
  editor: SlateEditor,
  saved: Descendant[],
  savedFromDisk: Descendant[],
  outside: Descendant[],
): Descendant[] | null {
  // The two reads of the saved text line up block for block, apart from
  // blocks the editor added at the end (an empty last paragraph).
  if (
    saved.length < savedFromDisk.length ||
    !savedFromDisk.every((node, index) => isSameNode(node, saved[index]))
  ) {
    return null;
  }

  const theirs = diffBlocks(savedFromDisk, outside);
  if (!theirs.length) return saved;

  const edited = editor.children;
  const ours = diffBlocks(saved, edited, { byIdentity: true });
  const placed = mergeHunks(ours, theirs, (mine, hunk) => {
    const mineBlocks = nextBlocks(edited, mine);
    const theirBlocks = nextBlocks(outside, hunk);
    return (
      mineBlocks.length === theirBlocks.length &&
      mineBlocks.every((node, index) => isSameNode(node, theirBlocks[index]))
    );
  });
  if (!placed) return null;

  replaceBlocks(
    editor,
    placed.map(({ hunk, start }) => ({
      start,
      end: start + hunk.end - hunk.start,
      blocks: nextBlocks(outside, hunk),
    })),
  );

  // The saved blocks with theirs in, as the editor now holds them, so the
  // next edits still show as new objects. A change both made alike is
  // taken as theirs read it.
  const placedAt = new Map(placed.map(({ hunk, start }) => [hunk, start]));
  const next: Descendant[] = [];
  let from = 0;
  let shift = 0;
  for (const hunk of theirs) {
    next.push(...saved.slice(from, hunk.start));
    const start = placedAt.get(hunk);
    if (start === undefined) {
      next.push(...nextBlocks(outside, hunk));
    } else {
      const count = hunk.nextEnd - hunk.nextStart;
      next.push(...editor.children.slice(start + shift, start + shift + count));
      shift += count - (hunk.end - hunk.start);
    }
    from = hunk.end;
  }
  next.push(...saved.slice(from));
  return next;
}

/**
 * Replaces blocks of `editor` (`start`–`end`, sorted, in its blocks as they
 * are) without saving that to history. Undo steps elsewhere keep working.
 */
function replaceBlocks(editor: SlateEditor, changes: BlockChange[]) {
  if (!changes.length) return;
  outsideChangeEditors.add(editor);
  // The cursor's text is going; letting the cursor go keeps the editor from
  // scrolling to wherever it would land.
  const { selection } = editor;
  if (
    selection &&
    [selection.anchor, selection.focus].some((point) =>
      changes.some(
        ({ start, end }) => point.path[0] >= start && point.path[0] < end,
      ),
    )
  ) {
    editor.tf.deselect();
  }

  const applied = editor.operations.length;
  let expected = 0;
  editor.tf.withoutSaving(() => {
    editor.tf.withoutNormalizing(() => {
      // From the end, so the blocks before each change stay put.
      for (const { start, end, blocks } of [...changes].reverse()) {
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
        expected += end - start + blocks.length;
      }
    });
  });

  const extra = editor.operations
    .slice(applied)
    .filter((op) => op.type !== "set_selection").length - expected;
  if (extra === 0) {
    rebaseHistory(
      editor,
      changes.map(({ start, end, blocks }) => ({ start, end, count: blocks.length })),
    );
  } else {
    // Normalizing changed more than the blocks; old steps can't apply.
    editor.history.undos = [];
    editor.history.redos = [];
  }
}

type BlockChange = { start: number; end: number; blocks: Descendant[] };

/** `Note.md` → `Note (Changed outside).md`, numbered if that name is taken. */
export async function freeCopyPath(filePath: string) {
  const base = filePath.replace(/\.md$/i, "");
  for (let n = 1; ; n += 1) {
    const label = n === 1 ? "Changed outside" : `Changed outside ${n}`;
    const path = `${base} (${label}).md`;
    if (!(await fileExists(path))) return path;
  }
}
