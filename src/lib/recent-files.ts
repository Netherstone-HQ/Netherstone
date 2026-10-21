import { isPathWithin, isSamePath } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";
import { useUIStore, type RecentFileEntry } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

/** The Recent list as the sidebar shows it: empty when Recent is off. */
export function shownRecentFiles(
  recentFiles: RecentFileEntry[],
  vaultPath: string | null,
  show: boolean,
  limit: number,
): RecentFileEntry[] {
  if (!vaultPath || !show) return [];
  return recentFiles
    .filter((file) => isPathWithin(file.path, vaultPath))
    .slice(0, limit);
}

/** The Recent list being stepped through while Ctrl is held. */
let cycle: { files: RecentFileEntry[]; index: number } | null = null;
let opening: Promise<void> | null = null;
let nextPath: string | null = null;

/** The file on screen: the drawing in Canvas, otherwise the open shard. */
function openFilePath() {
  const { appMode, activeDrawingPath } = useUIStore.getState();
  return appMode === "canvas"
    ? activeDrawingPath
    : useEditorStore.getState().currentFilePath;
}

/** Opens `path`, after any open already running; only the last one waits. */
function openInTurn(path: string) {
  nextPath = path;
  if (opening) return;

  opening = (async () => {
    while (nextPath) {
      const target = nextPath;
      nextPath = null;
      try {
        await openVaultFile(target);
      } catch (error) {
        console.error("[Netherstone] Failed to open recent file:", error);
      }
    }
    opening = null;
  })();
}

/**
 * Ctrl+Tab and Ctrl+Shift+Tab: opens the next or previous file in Recent.
 * The list stays as it was at the first press until Ctrl is let go, so
 * pressing again keeps going down it instead of swapping between two.
 */
export function stepRecentFile(step: 1 | -1) {
  if (!cycle) {
    const { recentFiles } = useUIStore.getState();
    const { showRecentFiles, recentFilesLimit } = useSettingsStore.getState();
    const files = shownRecentFiles(
      recentFiles,
      useVaultStore.getState().currentVaultPath,
      showRecentFiles,
      recentFilesLimit,
    );
    const openPath = openFilePath();
    const index = openPath
      ? files.findIndex((file) => isSamePath(file.path, openPath))
      : -1;
    // With the open file not in the list, the first step lands on its
    // first or last file.
    cycle = {
      files,
      index: index === -1 && step === -1 ? files.length : index,
    };
  }

  const { files } = cycle;
  if (files.length === 0) return;

  cycle.index = (cycle.index + step + files.length) % files.length;
  openInTurn(files[cycle.index].path);
}

/** Ctrl let go: the next Ctrl+Tab starts from the top of Recent again. */
export function endRecentCycle() {
  cycle = null;
}
