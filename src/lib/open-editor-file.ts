import { toast } from "sonner";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  openMarkdownFile,
  type OpenMarkdownFileResult,
} from "@/lib/editor-ast-cache";
import { useEditorStore, type OpenEditorFilePayload } from "@/store/editor";
import { useUIStore } from "@/store/ui";

export function toOpenEditorFilePayload(
  result: OpenMarkdownFileResult,
): OpenEditorFilePayload {
  return {
    path: result.filePath,
    content: result.markdown,
    plateValue: result.plateValue,
    cacheHit: result.cacheHit,
  };
}

export async function openEditorFile(
  filePath: string,
): Promise<OpenMarkdownFileResult> {
  const { setOpeningFilePath } = useEditorStore.getState();
  setOpeningFilePath(filePath);
  try {
    return await readAndOpenFile(filePath);
  } finally {
    // Another open may have started since; leave its path in place.
    if (useEditorStore.getState().openingFilePath === filePath) {
      setOpeningFilePath(null);
    }
  }
}

async function readAndOpenFile(
  filePath: string,
): Promise<OpenMarkdownFileResult> {
  const openStartTime = performance.now();

  console.info("[Netherstone][Open File] start", {
    filePath,
  });

  // Opening a file replaces the editor session, so persist pending edits to
  // the current file first. If that save fails, stay on the current file
  // rather than discarding its edits.
  await flushPendingAutosave();

  const editorState = useEditorStore.getState();
  if (editorState.isDirty && editorState.currentFilePath) {
    const fileName =
      editorState.currentFilePath.split(/[\\/]/).pop() ??
      editorState.currentFilePath;

    toast.error(`Couldn't save ${fileName}`, {
      description: "Your changes are still open. Try again in a moment.",
    });
    throw new Error(
      `Unsaved changes in ${editorState.currentFilePath} could not be saved before opening ${filePath}.`,
    );
  }

  const result = await openMarkdownFile(filePath);
  const afterBackendOpenTime = performance.now();

  console.info(
    `[Netherstone] AST cache ${result.cacheHit ? "hit" : "miss"} for open: ${result.filePath}`,
    {
      filePath: result.filePath,
      cacheHit: result.cacheHit,
      contentHash: result.contentHash,
      hasPlateValue: Array.isArray(result.plateValue),
      markdownChars: result.markdown.length,
      backendOpenDurationMs: Number(
        (afterBackendOpenTime - openStartTime).toFixed(2),
      ),
    },
  );

  const storeOpenStartTime = performance.now();
  const payload = toOpenEditorFilePayload(result);

  console.info("[Netherstone][Open File] store:open:start", {
    filePath: result.filePath,
    cacheHit: result.cacheHit,
    hasInitialValue: Array.isArray(payload.plateValue),
  });

  useEditorStore.getState().openFile(payload);
  useUIStore.getState().pushRecentFile({
    path: result.filePath,
    name: result.filePath.split(/[\\/]/).pop() ?? result.filePath,
  });

  const afterStoreOpenTime = performance.now();

  console.info("[Netherstone][Open File] store:open:complete", {
    filePath: result.filePath,
    cacheHit: result.cacheHit,
    backendOpenDurationMs: Number(
      (afterBackendOpenTime - openStartTime).toFixed(2),
    ),
    storeOpenDurationMs: Number(
      (afterStoreOpenTime - storeOpenStartTime).toFixed(2),
    ),
    totalOpenDispatchDurationMs: Number(
      (afterStoreOpenTime - openStartTime).toFixed(2),
    ),
  });

  return result;
}
