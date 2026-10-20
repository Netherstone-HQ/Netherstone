import { lazy, Suspense, useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { FilePlusIcon } from "lucide-react";

import type { RowAction } from "@/components/vault/RowActions";
import { readDrawingFile } from "@/lib/commands";
import { parseDrawing, type ExportableScene } from "@/lib/drawing-exports";
import { readVersion, type FileVersion } from "@/lib/history";
import { saveVersionCopy } from "@/lib/history-restore";
import { useVaultStore } from "@/store/vault";
import { VersionBar } from "./VersionBar";

const DrawingVersionCanvas = lazy(() => import("./DrawingVersionCanvas"));

type Loaded = {
  id: string;
  json: string;
  version: ExportableScene;
  current: ExportableScene["elements"];
};

/** An earlier version of the open drawing in the canvas's place. */
export function DrawingVersionView({
  version,
  filePath,
  liveCanvas,
  theme,
}: {
  version: FileVersion;
  filePath: string;
  /** The drawing as it is now, when it's open. */
  liveCanvas: ExcalidrawImperativeAPI | null;
  theme: "light" | "dark";
}) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [loaded, setLoaded] = useState<
    Loaded | { id: string; error: true } | null
  >(null);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    void (async () => {
      const json = await readVersion(vaultPath, version.blob);
      const [scene, current] = await Promise.all([
        parseDrawing(json),
        liveCanvas
          ? liveCanvas.getSceneElementsIncludingDeleted()
          : readDrawingFile(filePath)
              .then(parseDrawing)
              .then((s) => s.elements),
      ]);
      if (!cancelled)
        setLoaded({ id: version.id, json, version: scene, current });
    })().catch((error) => {
      console.error("[Netherstone] Couldn't show a version:", error);
      if (!cancelled) setLoaded({ id: version.id, error: true });
    });
    return () => {
      cancelled = true;
    };
    // The drawing as it is now is read once per version picked.
  }, [vaultPath, filePath, version.id, version.blob]);

  const shown = loaded?.id === version.id ? loaded : null;
  const json = shown && "json" in shown ? shown.json : null;
  const moreActions: RowAction[] = json
    ? [
        {
          label: "Save as a copy",
          icon: FilePlusIcon,
          onSelect: () => void saveVersionCopy(filePath, json),
        },
      ]
    : [];

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <VersionBar version={version} moreActions={moreActions} />
      {shown === null ? null : "error" in shown ? (
        <p className="px-6 py-10 text-center text-ui text-muted-foreground">
          This version couldn't be opened.
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <DrawingVersionCanvas
              key={shown.id}
              version={shown.version}
              current={shown.current}
              theme={theme}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
