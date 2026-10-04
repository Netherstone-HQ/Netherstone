import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { Plate, usePlateEditor } from "platejs/react";
import { toast } from "sonner";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { getPlateHeadingList } from "@/lib/plate-toc-headings";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { useEditorStore, useSettingsStore } from "@/store";
import { EditorKit } from "./editor-kit";
import { measureChunkHeightsInBackground } from "./lib/chunk-heights";
import { insertManagedMediaFiles } from "./lib/media-insert";
import {
  formatEditorLifecycleDurationMs,
  getEditorLifecycleDurationMs,
  getEditorLifecycleNowMs,
  logEditorLifecycle,
} from "./lib/editor-lifecycle";

const STRUCTURAL_OP_TYPES = new Set([
  "insert_node",
  "remove_node",
  "set_node",
  "split_node",
  "merge_node",
]);

/**
 * Top-level blocks per Slate chunk. Each chunk renders with
 * `content-visibility: auto`, so the browser skips layout and paint for
 * off-screen chunks, and edits only re-render the chunk they touch.
 * Plate's default (1000) is too coarse to help typical long notes.
 */
const EDITOR_CHUNK_SIZE = 100;

type MountedEditorProps = {
  content: string;
  currentFilePath: string;
  initialValue: any[];
  cacheHit: boolean;
};

export const MountedEditor = memo(function MountedEditor({
  content,
  currentFilePath,
  initialValue,
  cacheHit,
}: MountedEditorProps) {
  const didWriteColdOpenCacheRef = useRef(false);
  const mountStartMsRef = useRef(getEditorLifecycleNowMs());
  const mountRenderLoggedRef = useRef(false);
  const suppressInitialChangeRef = useRef(true);

  const nodeCount = initialValue.length;

  const usePlateEditorStartMs = getEditorLifecycleNowMs();
  const editor = usePlateEditor({
    plugins: EditorKit,
    value: initialValue,
    chunking: { chunkSize: EDITOR_CHUNK_SIZE },
  });
  const usePlateEditorDurationMs = getEditorLifecycleDurationMs(
    usePlateEditorStartMs,
  );

  if (!mountRenderLoggedRef.current) {
    mountRenderLoggedRef.current = true;

    logEditorLifecycle("mount:render:usePlateEditor", {
      filePath: currentFilePath,
      cacheHit,
      nodeCount,
      usePlateEditorDurationMs,
    });
  }

  const setPlateEditor = useEditorStore((s) => s.setPlateEditor);
  const setTocHeadings = useEditorStore((s) => s.setTocHeadings);
  const setIsDirty = useEditorStore((s) => s.setIsDirty);
  const bumpEditTick = useEditorStore((s) => s.bumpEditTick);
  const spellcheck = useSettingsStore((s) => s.spellcheck);

  const insertFilesFromEvent = (
    files: FileList | File[] | null | undefined,
    source: "drop" | "paste",
  ) => {
    if (!files || files.length === 0) return false;

    const fileCount = files.length;
    const toastId = toast.loading(
      fileCount === 1
        ? "Adding attachment…"
        : `Adding ${fileCount} attachments…`,
    );

    void insertManagedMediaFiles(editor, files, {
      debug: true,
      select: true,
    })
      .then(() => {
        toast.dismiss(toastId);
      })
      .catch((error) => {
        toast.dismiss(toastId);
        console.error(`[Netherstone] Failed to insert ${source} files:`, error);
        toast.error(
          `Failed to add ${source === "paste" ? "pasted" : "dropped"} files`,
          {
            description:
              error instanceof Error
                ? error.message
                : "Unknown attachment error.",
          },
        );
      });

    return true;
  };

  const handlePasteCapture = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (insertFilesFromEvent(event.clipboardData?.files, "paste")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleDropCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (insertFilesFromEvent(event.dataTransfer?.files, "drop")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  useLayoutEffect(() => {
    // Plate may normalize the initial value on mount; those operations are not
    // user edits and must not mark the document dirty.
    const allowDirtyTrackingId = window.requestAnimationFrame(() => {
      suppressInitialChangeRef.current = false;
    });

    logEditorLifecycle("mount:commit", {
      filePath: currentFilePath,
      cacheHit,
      nodeCount,
      commitDuration: formatEditorLifecycleDurationMs(mountStartMsRef.current),
    });

    const firstPaintRafId = window.requestAnimationFrame(() => {
      logEditorLifecycle("mount:first-paint", {
        filePath: currentFilePath,
        cacheHit,
        nodeCount,
        firstPaintDuration: formatEditorLifecycleDurationMs(
          mountStartMsRef.current,
        ),
      });
    });

    return () => {
      window.cancelAnimationFrame(allowDirtyTrackingId);
      window.cancelAnimationFrame(firstPaintRafId);
    };
  }, [cacheHit, currentFilePath, nodeCount]);

  useEffect(() => {
    setPlateEditor(editor);

    const tocStartMs = getEditorLifecycleNowMs();
    const tocHeadings = getPlateHeadingList(editor);

    setTocHeadings(tocHeadings);

    logEditorLifecycle("mount:ready", {
      filePath: currentFilePath,
      cacheHit,
      nodeCount,
      tocHeadingCount: tocHeadings.length,
      tocDuration: formatEditorLifecycleDurationMs(tocStartMs),
      totalMountDuration: formatEditorLifecycleDurationMs(
        mountStartMsRef.current,
      ),
    });

    return () => {
      logEditorLifecycle("mount:cleanup", {
        filePath: currentFilePath,
        cacheHit,
        lifetime: formatEditorLifecycleDurationMs(mountStartMsRef.current),
      });

      setPlateEditor(null);
      setTocHeadings([]);
    };
  }, [
    cacheHit,
    currentFilePath,
    editor,
    nodeCount,
    setPlateEditor,
    setTocHeadings,
  ]);

  useEffect(() => {
    const root = editor.api.toDOMNode(editor);
    if (!root) return;

    return measureChunkHeightsInBackground(root);
  }, [editor]);

  useEffect(() => {
    if (cacheHit || didWriteColdOpenCacheRef.current) return;

    didWriteColdOpenCacheRef.current = true;
    const coldOpenCacheWriteStartMs = getEditorLifecycleNowMs();

    void upsertAstCache({
      filePath: currentFilePath,
      markdown: content,
      plateValue: initialValue,
    })
      .then(() => {
        logEditorLifecycle("cold-open-cache-write:success", {
          filePath: currentFilePath,
          duration: formatEditorLifecycleDurationMs(coldOpenCacheWriteStartMs),
        });
      })
      .catch((error) => {
        console.error("Failed to write cold-open AST cache:", {
          filePath: currentFilePath,
          duration: formatEditorLifecycleDurationMs(coldOpenCacheWriteStartMs),
          error,
        });
      });
  }, [cacheHit, content, currentFilePath, initialValue]);

  return (
    <Plate
      editor={editor}
      onChange={() => {
        const hasDocumentChange = editor.operations.some(
          (op: any) => op.type !== "set_selection",
        );

        if (suppressInitialChangeRef.current) {
          if (hasDocumentChange) {
            logEditorLifecycle("mount:initial-change-suppressed", {
              filePath: currentFilePath,
              operationTypes: editor.operations.map((op: any) => op.type),
            });
          }

          return;
        }

        if (!hasDocumentChange) return;

        if (!useEditorStore.getState().isDirty) {
          setIsDirty(true);
        }

        bumpEditTick();

        if (
          editor.operations.some((op: any) => STRUCTURAL_OP_TYPES.has(op.type))
        ) {
          setTocHeadings(getPlateHeadingList(editor));
        }
      }}
    >
      <EditorContainer
        onDropCapture={handleDropCapture}
        onPasteCapture={handlePasteCapture}
      >
        <PlateEditor placeholder="Start writing..." spellCheck={spellcheck} />
      </EditorContainer>
    </Plate>
  );
});
