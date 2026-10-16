import { useEditorStore, useUIStore } from "@/store";

/** The file on screen: the open drawing in Canvas, the open shard elsewhere. */
export function useOpenFilePath() {
  const drawingPath = useUIStore((s) =>
    s.appMode === "canvas" ? s.activeDrawingPath : undefined,
  );
  const shardPath = useEditorStore((s) => s.currentFilePath);

  return drawingPath === undefined ? shardPath : drawingPath;
}
