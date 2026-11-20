import { toast } from "sonner";
import {
  flushPendingAutosave,
  holdOpenShardCache,
  writeLeftShardCaches,
} from "@/hooks/useAutosave";
import { fillDrawingPictures } from "@/lib/drawing-exports";
import {
  openMarkdownFile,
  type OpenMarkdownFileResult,
} from "@/lib/editor-ast-cache";
import { finishVoiceNoteBeforeLeaving } from "@/lib/voice/voice-note";
import { useEditorStore, type OpenEditorFilePayload } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import type { Descendant } from "platejs";

function toOpenEditorFilePayload(
  result: OpenMarkdownFileResult,
  unsavedValue?: Descendant[],
): OpenEditorFilePayload {
  return {
    path: result.filePath,
    content: result.markdown,
    plateValue: unsavedValue ?? result.plateValue,
    cacheHit: result.cacheHit,
    unsaved: unsavedValue !== undefined,
  };
}

/**
 * Opens a shard. With `unsavedValue`, the editor shows those blocks instead
 * of the saved ones, as edits still to save.
 */
export async function openEditorFile(
  filePath: string,
  unsavedValue?: Descendant[],
): Promise<OpenMarkdownFileResult> {
  const { setOpeningFilePath } = useEditorStore.getState();
  setOpeningFilePath(filePath);
  try {
    return await readAndOpenFile(filePath, unsavedValue);
  } finally {
    // Another open may have started since; leave its path in place.
    if (useEditorStore.getState().openingFilePath === filePath) {
      setOpeningFilePath(null);
    }
  }
}

/** Saves the open shard now, and says so if it couldn't. */
export async function saveEditorFile() {
  await saveOpenShard();
}

/** Saves the open shard and closes it. It stays open if the save fails. */
export async function closeEditorFile() {
  if ((await finishVoiceNoteBeforeLeaving()) && (await saveOpenShard())) {
    useEditorStore.getState().closeFile();
  }
}

/**
 * Saves pending edits to the open shard before it's replaced or closed.
 * Returns false, and says so, if they couldn't be saved.
 */
async function saveOpenShard(): Promise<boolean> {
  await flushPendingAutosave();
  holdOpenShardCache();

  const { isDirty, currentFilePath } = useEditorStore.getState();
  if (!isDirty || !currentFilePath) return true;

  const fileName = currentFilePath.split(/[\\/]/).pop() ?? currentFilePath;
  toast.error(`Couldn't save ${fileName}`, {
    description: "Your changes are still open. Try again in a moment.",
  });
  return false;
}

async function readAndOpenFile(
  filePath: string,
  unsavedValue?: Descendant[],
): Promise<OpenMarkdownFileResult> {
  // Opening a file replaces the editor session. If the open shard's edits
  // can't be saved, stay on it rather than discard them.
  if (!(await finishVoiceNoteBeforeLeaving()) || !(await saveOpenShard())) {
    throw new Error(
      `Unsaved changes could not be saved before opening ${filePath}.`,
    );
  }

  // A shard left moments ago may still hold its cache entry.
  await writeLeftShardCaches(filePath);
  const result = await openMarkdownFile(filePath);

  useEditorStore.getState().openFile(toOpenEditorFilePayload(result, unsavedValue));
  useUIStore.getState().pushRecentFile({
    path: result.filePath,
    name: result.filePath.split(/[\\/]/).pop() ?? result.filePath,
  });

  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (vaultPath) {
    void fillDrawingPictures(result.filePath, result.markdown, vaultPath);
  }

  return result;
}
