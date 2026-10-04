import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  getSceneVersion,
  MainMenu,
  restore,
  serializeAsJSON,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { FileImageIcon, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { DrawingMenu } from "@/components/DrawingMenu";
import { Button } from "@/components/ui/button";
import {
  appendMarkdownToFile,
  chooseExportTargetShardDialog,
  createDrawingFile,
  readDrawingFile,
  readMarkdownFile,
  saveDrawingFile,
  saveMarkdownFile,
  scanVault,
} from "@/lib/commands";
import {
  getDrawingAltText,
  persistScenePng,
  refreshLinkedDrawingImages,
} from "@/lib/drawing-exports";
import {
  buildDrawingImageTag,
  isPathWithin,
  registerDrawingSaver,
  replaceLinkedDrawingImages,
  toVaultRelativePath,
} from "@/lib/drawing-files";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { useEditorStore } from "@/store/editor";
import { openEditorFile } from "@/lib/open-editor-file";
import { suppressVaultChangePath } from "@/lib/vault-change-suppression";
import { useUIStore, useVaultStore } from "@/store";

import "@excalidraw/excalidraw/index.css";

const DRAWING_SAVE_DELAY_MS = 1000;

type SceneElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];

type Scene = {
  elements: SceneElements;
  appState: Partial<AppState>;
  files: BinaryFiles;
};

interface ExcalidrawCanvasProps {
  theme: "light" | "dark";
  libraryReturnUrl: string;
  /**
   * The vault drawing being edited, or null for a scratch canvas. Switching
   * drawings remounts the canvas; a rename only updates this.
   */
  drawingPath: string | null;
}

function getShardVaultPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");

  return slashIndex >= 0 ? filePath.slice(0, slashIndex) : "";
}

function getShardName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Parses a `.excalidraw` file into restored scene data. */
function parseDrawing(json: string) {
  const data = json.trim() ? JSON.parse(json) : {};

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("The file is not an Excalidraw drawing.");
  }

  return restore(
    {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState: data.appState ?? {},
      files: data.files ?? {},
    },
    null,
    null,
  );
}

/**
 * Identifies the saved parts of a scene. Scroll, zoom and selection are not
 * saved, so changing only those does not trigger a write.
 */
function getSceneSaveKey({ elements, appState, files }: Scene) {
  return [
    getSceneVersion(elements),
    Object.keys(files).sort().join(","),
    appState.viewBackgroundColor ?? "",
    appState.gridModeEnabled ?? "",
    appState.gridSize ?? "",
  ].join("|");
}

function serializeScene({ elements, appState, files }: Scene) {
  return serializeAsJSON(elements, appState, files, "local");
}

export type DrawingSaveStatus = "saved" | "saving" | "error";

const NEW_DRAWING_NAME = "Untitled";

/**
 * Loads the drawing open when the canvas mounts and autosaves changes to the
 * current `drawingPath`, which may change without a remount when the drawing
 * is renamed or moved. A scratch canvas is saved as a new "Untitled" drawing
 * in the vault as soon as something is drawn on it.
 */
function useDrawingPersistence(drawingPath: string | null) {
  const openDrawing = useUIStore((s) => s.openDrawing);
  const setActiveDrawingPath = useUIStore((s) => s.setActiveDrawingPath);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const [initialPath] = useState(drawingPath);
  const [initialData, setInitialData] = useState<
    ExcalidrawInitialDataState | null | undefined
  >(initialPath ? undefined : null);
  const [status, setStatus] = useState<DrawingSaveStatus>("saved");

  const pathRef = useRef(drawingPath);
  const vaultPathRef = useRef(currentVaultPath);
  const latestSceneRef = useRef<Scene | null>(null);
  const lastSavedKeyRef = useRef<string | null>(null);
  const writingKeyRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingWritesRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  // Saved changes not yet re-exported into the images linked to the drawing.
  const exportsStaleRef = useRef(false);
  const refreshChainRef = useRef<Promise<void>>(Promise.resolve());

  pathRef.current = drawingPath;
  vaultPathRef.current = currentVaultPath;

  useEffect(() => {
    if (!initialPath) return;

    let cancelled = false;

    readDrawingFile(initialPath)
      .then((json) => {
        if (cancelled) return;

        const restored = parseDrawing(json);
        lastSavedKeyRef.current = getSceneSaveKey(restored);
        setInitialData(restored);
      })
      .catch((error) => {
        if (cancelled) return;

        console.error("[Netherstone] Failed to open drawing:", error);
        toast.error(`Couldn't open ${getShardName(initialPath)}`, {
          description: error instanceof Error ? error.message : String(error),
        });
        // Fall back to a scratch canvas. Never autosave over a file that
        // failed to load.
        openDrawing(null);
      });

    return () => {
      cancelled = true;
    };
  }, [initialPath, openDrawing]);

  const writeLatestScene = useCallback(async () => {
    const scene = latestSceneRef.current;
    if (!scene) return;

    const key = getSceneSaveKey(scene);
    if (key === lastSavedKeyRef.current) return;

    let path = pathRef.current;
    if (!path) {
      const vaultPath = vaultPathRef.current;
      const hasContent = scene.elements.some((element) => !element.isDeleted);
      if (!vaultPath || !hasContent) return;
    }

    writingKeyRef.current = key;
    try {
      if (!path) {
        path = await createDrawingFile(vaultPathRef.current!, NEW_DRAWING_NAME);
        pathRef.current = path;
        setActiveDrawingPath(path);
        useUIStore
          .getState()
          .pushRecentFile({ path, name: getShardName(path) });
        // The watcher event for the new file is suppressed with the save
        // below, so refresh the tree here.
        void scanVault(vaultPathRef.current!)
          .then((tree) => useVaultStore.getState().setFileTree(tree))
          .catch((error) =>
            console.error(
              "[Netherstone] Rescan after new drawing failed:",
              error,
            ),
          );
      }

      suppressVaultChangePath(path, { reason: "autosave" });
      await saveDrawingFile(path, serializeScene(scene));
      lastSavedKeyRef.current = key;
      exportsStaleRef.current = true;
    } finally {
      writingKeyRef.current = null;
    }
  }, [setActiveDrawingPath]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    pendingWritesRef.current += 1;
    setStatus("saving");

    saveChainRef.current = saveChainRef.current.then(writeLatestScene).then(
      () => {
        pendingWritesRef.current -= 1;
        if (pendingWritesRef.current === 0 && timerRef.current === null) {
          setStatus("saved");
        }
      },
      (error) => {
        pendingWritesRef.current -= 1;
        setStatus("error");
        console.error("[Netherstone] Failed to save drawing:", error);
        toast.error("Couldn't save drawing", {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );

    return saveChainRef.current;
  }, [writeLatestScene]);

  /**
   * Re-exports the saved drawing into the shards that embed it. Runs when
   * the user leaves the drawing rather than on every save, so editing does
   * not create a new image each second.
   */
  const refreshExports = useCallback(() => {
    refreshChainRef.current = refreshChainRef.current.then(async () => {
      const path = pathRef.current;
      const vaultPath = vaultPathRef.current;
      const scene = latestSceneRef.current;
      if (!exportsStaleRef.current || !path || !vaultPath || !scene) return;

      exportsStaleRef.current = false;
      // Keep the last image rather than replacing it with an empty one.
      if (!scene.elements.some((element) => !element.isDeleted)) return;

      try {
        const count = await refreshLinkedDrawingImages(path, vaultPath, scene);
        if (count > 0) {
          toast.success(
            count === 1
              ? "Updated drawing in 1 shard"
              : `Updated drawing in ${count} shards`,
            { description: getDrawingAltText(path) },
          );
        }
      } catch (error) {
        exportsStaleRef.current = true;
        console.error(
          "[Netherstone] Failed to update exported drawing:",
          error,
        );
        toast.error("Couldn't update the drawing in your shards", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return refreshChainRef.current;
  }, []);

  const finish = useCallback(
    () => flush().then(refreshExports),
    [flush, refreshExports],
  );

  useEffect(() => {
    const unregister = registerDrawingSaver({
      hasPendingSave: () =>
        timerRef.current !== null ||
        pendingWritesRef.current > 0 ||
        exportsStaleRef.current,
      flush,
      finish,
    });

    return () => {
      unregister();
      void finish();
    };
  }, [finish, flush]);

  // The canvas stays mounted while notes are shown, so leaving canvas mode
  // does not unmount it.
  const appMode = useUIStore((s) => s.appMode);
  useEffect(() => {
    if (appMode !== "canvas") void finish();
  }, [appMode, finish]);

  const onSceneChange = useCallback(
    (elements: SceneElements, appState: AppState, files: BinaryFiles) => {
      latestSceneRef.current = { elements, appState, files };
      if (initialData === undefined) return;

      // Already saved, or being saved right now.
      const key = getSceneSaveKey(latestSceneRef.current);
      if (key === lastSavedKeyRef.current || key === writingKeyRef.current) {
        return;
      }

      // Nothing to save yet: an empty scratch canvas, or no vault to save to.
      if (
        !pathRef.current &&
        (!vaultPathRef.current ||
          !elements.some((element) => !element.isDeleted))
      ) {
        return;
      }

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      setStatus("saving");
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, DRAWING_SAVE_DELAY_MS);
    },
    [flush, initialData],
  );

  return { initialData, onSceneChange, status };
}

export function ExcalidrawCanvas({
  theme,
  libraryReturnUrl,
  drawingPath,
}: ExcalidrawCanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isExportingToShard, setIsExportingToShard] = useState(false);
  const [isImageExportDialogOpen, setIsImageExportDialogOpen] = useState(false);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const setAppMode = useUIStore((s) => s.setAppMode);
  const { initialData, onSceneChange, status } =
    useDrawingPersistence(drawingPath);

  useHandleLibrary({ excalidrawAPI });

  const openImageExportDialog = () => {
    if (!excalidrawAPI) {
      toast.error("Canvas is not ready yet.");
      return;
    }

    excalidrawAPI.updateScene({
      appState: {
        openDialog: { name: "imageExport" },
      },
    });
  };

  const exportCanvasToShard = async () => {
    if (!excalidrawAPI) {
      toast.error("Canvas is not ready yet.");
      return;
    }

    const elements = excalidrawAPI.getSceneElements();
    if (!Array.isArray(elements) || elements.length === 0) {
      toast.error("Draw something before exporting to a shard.");
      return;
    }

    const shard = await chooseExportTargetShardDialog(currentVaultPath);
    if (!shard) return;

    const vaultPath = getShardVaultPath(shard.filePath) || shard.vaultPath;
    if (!vaultPath) {
      toast.error("Could not resolve the selected shard's vault folder.");
      return;
    }

    setIsExportingToShard(true);
    const toastId = toast.loading("Exporting canvas to shard…");

    try {
      const attachment = await persistScenePng(
        {
          elements,
          appState: excalidrawAPI.getAppState(),
          files: excalidrawAPI.getFiles(),
        },
        vaultPath,
        drawingPath ? getDrawingAltText(drawingPath) : undefined,
      );
      const vaultPathOfShard = useVaultStore.getState().currentVaultPath;
      // Link the image to its drawing so it can be edited and re-exported,
      // as long as the shard is in the same vault as the drawing.
      const drawingRef =
        drawingPath &&
        vaultPathOfShard &&
        isPathWithin(shard.filePath, vaultPathOfShard)
          ? toVaultRelativePath(drawingPath, vaultPathOfShard)
          : null;
      const altText = drawingPath
        ? getDrawingAltText(drawingPath)
        : attachment.originalName.replace(/\.[^.]+$/, "");
      const buildTag = (width: string | null) =>
        buildDrawingImageTag({
          src: attachment.assetPath,
          alt: altText,
          width: width ?? "480",
          drawingRef,
        });

      // The shard may be open in the editor: save its edits first, and
      // reload it after writing so the editor doesn't save over the export.
      await flushPendingAutosave();

      const existing = drawingRef
        ? replaceLinkedDrawingImages(
            await readMarkdownFile(shard.filePath),
            drawingRef,
            buildTag,
          )
        : null;

      if (existing !== null) {
        await saveMarkdownFile(shard.filePath, existing);
      } else {
        await appendMarkdownToFile(shard.filePath, buildTag(null));
      }

      if (useEditorStore.getState().currentFilePath === shard.filePath) {
        await openEditorFile(shard.filePath);
      }

      const shardName = getShardName(shard.filePath);

      excalidrawAPI.updateScene({
        appState: {
          openDialog: null,
        },
      });
      setIsImageExportDialogOpen(false);

      toast.success(
        existing !== null
          ? "Updated drawing in shard"
          : "Exported canvas to shard",
        {
          id: toastId,
          description: shardName,
          action: {
            label: "Open shard",
            onClick: () => {
              setAppMode("notes");
              void openEditorFile(shard.filePath);
            },
          },
        },
      );
    } catch (error) {
      console.error("[Netherstone] Failed to export canvas to shard:", error);
      toast.error("Failed to export canvas to shard", {
        id: toastId,
        description:
          error instanceof Error ? error.message : "Unknown export error.",
      });
    } finally {
      setIsExportingToShard(false);
    }
  };

  if (initialData === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading drawing…
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      {isImageExportDialogOpen && (
        <div className="fixed inset-x-0 bottom-8 z-10000 flex justify-center pointer-events-none">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void exportCanvasToShard();
            }}
            disabled={isExportingToShard}
            className="pointer-events-auto shadow-lg"
          >
            <FileImageIcon />
            Export current options to Shard
          </Button>
        </div>
      )}

      <Excalidraw
        theme={theme}
        initialData={initialData}
        excalidrawAPI={setExcalidrawAPI}
        libraryReturnUrl={libraryReturnUrl}
        onChange={(elements, appState, files) => {
          onSceneChange(elements, appState, files);

          const isOpen = appState.openDialog?.name === "imageExport";
          setIsImageExportDialogOpen((current) =>
            current === isOpen ? current : isOpen,
          );
        }}
        renderTopRightUI={() => (
          <DrawingMenu
            drawingPath={drawingPath}
            saveStatus={status}
            onExport={openImageExportDialog}
          />
        )}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Item
            icon={<ImageIcon />}
            onSelect={() => {
              openImageExportDialog();
            }}
          >
            Export PNG to Shard...
          </MainMenu.Item>
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
