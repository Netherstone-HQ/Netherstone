import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  getSceneVersion,
  MainMenu,
  serializeAsJSON,
  useHandleLibrary,
  WelcomeScreen,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import { FolderOpenIcon, Grid3x3Icon } from "lucide-react";
import { toast } from "sonner";

import type { SaveState } from "@/components/SaveStatus";
import {
  createDrawingFile,
  readDrawingFile,
  saveDrawingFile,
  scanVault,
} from "@/lib/commands";
import {
  getDrawingAltText,
  parseDrawing,
  refreshLinkedDrawingImages,
} from "@/lib/drawing-exports";
import { registerDrawingSaver } from "@/lib/drawing-files";
import { IS_MAC } from "@/lib/platform";
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
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Receives Excalidraw's API once it's ready, and null when it's gone. */
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI | null) => void;
  onSaveStateChange: (state: SaveState) => void;
}

function getShardName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
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

const NEW_DRAWING_NAME = "Untitled";

/**
 * Drawings open from the vault and save themselves, so Excalidraw's own file
 * actions are off, Ctrl+O included: a file opened over a drawing would be
 * saved over it.
 */
const UI_OPTIONS: ExcalidrawProps["UIOptions"] = {
  canvasActions: { loadScene: false, export: false },
};

/** Excalidraw's own shortcut for the grid. */
const GRID_SHORTCUT = IS_MAC ? "⌘'" : "Ctrl+'";

const showDrawings = () => useUIStore.getState().setSidebarOpen(true);

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
  const [status, setStatus] = useState<SaveState>("saved");

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
      .then(parseDrawing)
      .then((restored) => {
        if (cancelled) return;

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
        setStatus("failed");
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
  excalidrawAPI,
  onExcalidrawAPI,
  onSaveStateChange,
}: ExcalidrawCanvasProps) {
  const { initialData, onSceneChange, status } =
    useDrawingPersistence(drawingPath);
  const [isGridShown, setIsGridShown] = useState(false);

  useHandleLibrary({ excalidrawAPI });

  const handleChange = useCallback(
    (elements: SceneElements, appState: AppState, files: BinaryFiles) => {
      onSceneChange(elements, appState, files);
      setIsGridShown(appState.gridModeEnabled);
    },
    [onSceneChange],
  );

  useEffect(() => {
    onSaveStateChange(status);
  }, [status, onSaveStateChange]);

  useEffect(() => () => onExcalidrawAPI(null), [onExcalidrawAPI]);

  if (initialData === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center text-ui text-muted-foreground">
        Loading drawing…
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      <Excalidraw
        theme={theme}
        initialData={initialData}
        excalidrawAPI={onExcalidrawAPI}
        libraryReturnUrl={libraryReturnUrl}
        onChange={handleChange}
        UIOptions={UI_OPTIONS}
      >
        {/* Saving and exporting go through the top bar's drawing menu, and
            the theme follows the app's. */}
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Item
            icon={<Grid3x3Icon />}
            shortcut={GRID_SHORTCUT}
            onSelect={() =>
              excalidrawAPI?.updateScene({
                appState: { gridModeEnabled: !isGridShown },
              })
            }
          >
            {isGridShown ? "Hide grid" : "Show grid"}
          </MainMenu.Item>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
        {/* Shown on an empty canvas. Drawing on it is what saves it, which
            nothing else on screen says. "Open an existing drawing" shows the
            left sidebar, where the vault's drawings are. */}
        <WelcomeScreen>
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              Your drawing is saved to your vault as you go.
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem
                icon={<FolderOpenIcon />}
                onSelect={showDrawings}
              >
                Open an existing drawing
              </WelcomeScreen.Center.MenuItem>
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  );
}
