import { useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ImageDownIcon, ImagePlusIcon } from "lucide-react";

import {
  AddToShardDialog,
  hasSomethingToAdd,
} from "@/components/canvas/AddToShardDialog";
import { HistoryToggle } from "@/components/history/HistoryToggle";
import { DrawingIcon } from "@/components/icons";
import {
  BrowserPanelToggle,
  LeftSidebarToggle,
} from "@/components/PanelToggles";
import { SaveStatus, type SaveState } from "@/components/SaveStatus";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileBreadcrumb } from "@/components/vault/FileBreadcrumb";
import type { RowAction } from "@/components/vault/RowActions";
import { finishDrawingSession } from "@/lib/drawing-files";
import { createDrawing } from "@/lib/open-vault-file";
import { useUIStore, useVaultStore } from "@/store";

function getScene(api: ExcalidrawImperativeAPI) {
  return {
    elements: api.getSceneElements(),
    appState: api.getAppState(),
    files: api.getFiles(),
  };
}

/** Saves the open drawing and leaves an empty canvas in its place. */
async function closeDrawing() {
  await finishDrawingSession();
  useUIStore.getState().openDrawing(null);
}

/**
 * Canvas's top bar, laid out like the Editor's: where the open drawing is,
 * its actions under its name, and its save state.
 */
export function CanvasHeader({
  drawingPath,
  saveState,
  excalidrawAPI,
}: {
  /** The open drawing, or null for an empty canvas not saved yet. */
  drawingPath: string | null;
  saveState: SaveState;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [isAddingToShard, setIsAddingToShard] = useState(false);

  const leadingActions: RowAction[] = vaultPath
    ? [
        {
          label: "New drawing",
          icon: DrawingIcon,
          onSelect: () => void createDrawing(vaultPath),
        },
      ]
    : [];
  const canAddToShard = !!drawingPath && !!excalidrawAPI;
  const startAddingToShard = () => {
    if (excalidrawAPI && hasSomethingToAdd(getScene(excalidrawAPI))) {
      setIsAddingToShard(true);
    }
  };
  const exportActions: RowAction[] = excalidrawAPI
    ? [
        {
          label: "Add to shard…",
          icon: ImagePlusIcon,
          onSelect: startAddingToShard,
        },
        {
          label: "Export image…",
          icon: ImageDownIcon,
          onSelect: () =>
            excalidrawAPI.updateScene({
              appState: { openDialog: { name: "imageExport" } },
            }),
        },
      ]
    : [];

  return (
    <header className="flex h-header shrink-0 items-center gap-1.5 border-b px-2.5">
      <LeftSidebarToggle />
      <Separator
        orientation="vertical"
        className="mx-1 h-4 data-vertical:self-center"
      />
      <FileBreadcrumb
        path={drawingPath}
        onClose={() => void closeDrawing()}
        leadingActions={leadingActions}
        exportActions={exportActions}
      />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {canAddToShard ? (
          <Button
            type="button"
            variant="ghost"
            onClick={startAddingToShard}
            className="h-control gap-1.5 px-2 text-ui text-muted-foreground hover:text-foreground"
          >
            <ImagePlusIcon />
            Add to shard
          </Button>
        ) : null}
        {drawingPath ? <SaveStatus state={saveState} /> : null}
        {drawingPath ? <HistoryToggle place="canvas" /> : null}
        <BrowserPanelToggle isCanvas />
      </div>
      {drawingPath && excalidrawAPI ? (
        <AddToShardDialog
          open={isAddingToShard}
          onOpenChange={setIsAddingToShard}
          drawingPath={drawingPath}
          getScene={() => getScene(excalidrawAPI)}
        />
      ) : null}
    </header>
  );
}
