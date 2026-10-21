import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plate, usePlateEditor } from "platejs/react";
import { toast } from "sonner";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { changesHeadings, getPlateHeadingList } from "@/lib/plate-toc-headings";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { isSamePath } from "@/lib/drawing-files";
import { rememberSavedValue, takeOutsideChange } from "@/lib/outside-changes";
import { useEditorStore, useSettingsStore, useUIStore } from "@/store";
import { EditorKit } from "./editor-kit";
import { measureChunkHeightsInBackground } from "./lib/chunk-heights";
import {
  ChunkDrawer,
  ChunkDrawerContext,
  registerChunkDrawer,
  renderDeferredChunk,
} from "./lib/deferred-chunks";
import {
  revealAttachment,
  revealLinkByText,
  revealTag,
} from "./lib/link-reveal";
import { insertManagedMediaFiles } from "./lib/media-insert";
import { getShardScrollPosition, useShardScroll } from "./lib/shard-scroll";
import {
  formatEditorLifecycleDurationMs,
  getEditorLifecycleDurationMs,
  getEditorLifecycleNowMs,
  logEditorLifecycle,
} from "./lib/editor-lifecycle";

/**
 * Top-level blocks per Slate chunk. Each chunk renders with
 * `content-visibility: auto`, so the browser skips layout and paint for
 * off-screen chunks, and edits only re-render the chunk they touch. Small
 * enough that laying out or drawing one chunk (a shard of tables is heavy)
 * fits in an idle moment. Plate's default (1000) is too coarse to help.
 */
const EDITOR_CHUNK_SIZE = 10;

/** Blocks drawn before the shard is shown; the rest follow in the background. */
const FIRST_DRAWN_BLOCKS = 4 * EDITOR_CHUNK_SIZE;

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
    // Plate's navigation feedback (the flash on a block a table of contents
    // panel jumps to) subscribes every block to every change. Nothing here
    // uses it, and in a long shard it was most of the time between a
    // keypress and the screen.
    navigationFeedback: false,
  });
  const usePlateEditorDurationMs = getEditorLifecycleDurationMs(
    usePlateEditorStartMs,
  );

  // Where the shard was left, and its blocks up to there drawn right away so
  // it can open at that place.
  const [savedPosition] = useState(() =>
    getShardScrollPosition(currentFilePath),
  );
  const [drawer] = useState(
    () => new ChunkDrawer((savedPosition?.block ?? 0) + FIRST_DRAWN_BLOCKS),
  );
  const [opensAtLink] = useState(() => {
    const { pendingLinkReveal } = useEditorStore.getState();
    return (
      pendingLinkReveal !== null &&
      isSamePath(pendingLinkReveal.path, currentFilePath)
    );
  });
  useShardScroll(editor, currentFilePath, savedPosition, !opensAtLink);

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
  const isShown = useUIStore((s) => s.appMode === "notes");

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

  // Select all and jumps to the end act on what's drawn, so draw it all.
  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === "a" || event.key === "A" || event.key === "End")
    ) {
      drawer.drawAll();
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

  useLayoutEffect(() => {
    registerChunkDrawer(editor, drawer);
  }, [drawer, editor]);

  const [isFullyDrawn, setIsFullyDrawn] = useState(false);
  useEffect(
    () =>
      drawer.drawInBackground(
        () => editor.children.length,
        EDITOR_CHUNK_SIZE,
        () => setIsFullyDrawn(true),
      ),
    [drawer, editor],
  );

  useEffect(() => {
    rememberSavedValue(editor, editor.children);
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

      // The next shard may already be on screen (this one is removed after
      // it's shown); only clear what's still this one's.
      if (useEditorStore.getState().plateEditor === editor) {
        setPlateEditor(null);
        setTocHeadings([]);
      }
    };
  }, [
    cacheHit,
    currentFilePath,
    editor,
    nodeCount,
    setPlateEditor,
    setTocHeadings,
  ]);

  // A link or missing file asked for when this shard was opened (from Broken
  // links on the Overview page), or a tag (from Tags): scroll to it once the
  // shard is on screen.
  useEffect(() => {
    if (!isShown) return;

    const { pendingLinkReveal, setPendingLinkReveal, plateEditor } =
      useEditorStore.getState();
    // A previous session still on screen while the next one prepares isn't
    // the store's editor any more; the new one shows the link.
    if (
      plateEditor !== editor ||
      !pendingLinkReveal ||
      !isSamePath(pendingLinkReveal.path, currentFilePath)
    ) {
      return;
    }

    setPendingLinkReveal(null);
    if ("assetPath" in pendingLinkReveal) {
      revealAttachment(editor, pendingLinkReveal.assetPath);
    } else if ("tag" in pendingLinkReveal) {
      revealTag(editor, pendingLinkReveal.tag);
    } else {
      revealLinkByText(editor, pendingLinkReveal.text);
    }
  }, [currentFilePath, editor, isShown]);

  // Measured once what's drawn first is on screen, and again once the rest
  // is: measuring each part as it's drawn slowed drawing a long shard.
  useEffect(() => {
    const root = editor.api.toDOMNode(editor);
    if (!root) return;

    return measureChunkHeightsInBackground(root);
  }, [editor, isFullyDrawn]);

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

        // Text that changed outside the app is already on disk.
        const isOutsideChange = takeOutsideChange(editor);

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

        if (!isOutsideChange && !useEditorStore.getState().isDirty) {
          setIsDirty(true);
        }

        bumpEditTick();

        if (changesHeadings(editor)) {
          setTocHeadings(getPlateHeadingList(editor));
        }
      }}
    >
      <ChunkDrawerContext.Provider value={drawer}>
        <EditorContainer
          onDropCapture={handleDropCapture}
          onKeyDownCapture={handleKeyDownCapture}
          onPasteCapture={handlePasteCapture}
        >
          <PlateEditor
            placeholder="Start writing..."
            renderChunk={renderDeferredChunk}
            spellCheck={spellcheck}
          />
        </EditorContainer>
      </ChunkDrawerContext.Provider>
    </Plate>
  );
});
