import { useEffect, useMemo, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";

import type { ExportableScene } from "@/lib/drawing-exports";
import {
  ADDED_SHAPE_COLOR,
  REMOVED_SHAPE_COLOR,
  diffDrawingShapes,
} from "@/lib/drawing-diff";
import { useHistoryStore } from "@/store/history";

import "@excalidraw/excalidraw/index.css";

/** Nothing to change or save: the version is only looked at. */
const UI_OPTIONS: ExcalidrawProps["UIOptions"] = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: false,
  },
};

/**
 * An earlier version of a drawing, read-only, laid over the drawing as it is
 * now (see `diffDrawingShapes`).
 */
export default function DrawingVersionCanvas({
  version,
  current,
  theme,
}: {
  version: ExportableScene;
  current: ExportableScene["elements"];
  theme: "light" | "dark";
}) {
  const showChanges = useHistoryStore((s) => s.showChanges);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const diff = useMemo(
    () => diffDrawingShapes(version.elements, current, showChanges),
    [version, current, showChanges],
  );
  const [initialData] = useState(() => ({
    elements: diff.shapes,
    appState: {
      viewBackgroundColor: version.appState.viewBackgroundColor,
      gridModeEnabled: false,
    },
    files: version.files,
    scrollToContent: true,
  }));

  useEffect(() => {
    api?.updateScene({ elements: diff.shapes });
  }, [api, diff]);

  return (
    <div className="relative h-full min-h-0">
      <Excalidraw
        theme={theme}
        initialData={initialData}
        excalidrawAPI={setApi}
        viewModeEnabled
        UIOptions={UI_OPTIONS}
      />
      {showChanges && diff.hasChanges ? (
        <div className="pointer-events-none absolute top-4 right-4 z-10 flex gap-4 rounded-md border bg-card px-3 py-2 text-ui-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-3.5 rounded-xs border-2"
              style={{ borderColor: ADDED_SHAPE_COLOR }}
            />
            Added
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-4 border-t-2 border-dashed"
              style={{ borderColor: REMOVED_SHAPE_COLOR }}
            />
            Removed
          </span>
        </div>
      ) : null}
    </div>
  );
}
