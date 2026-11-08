import { toast } from "sonner";

import { fileExists } from "@/lib/commands/attachments";
import {
  getVaultFileDisplayName,
  isPathWithin,
  isSamePath,
} from "@/lib/drawing-files";
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

/**
 * Opens a file from Recent. One that's no longer in the vault comes off
 * Recent, and a toast says so, instead of the click doing nothing.
 */
export async function openRecentFile(path: string): Promise<boolean> {
  if (!(await fileExists(path))) {
    useUIStore.getState().dropRecentFile(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    toast.error(`Couldn't find ${getVaultFileDisplayName(name)}`, {
      description: "It's no longer in this vault, so Recent doesn't list it.",
    });
    return false;
  }
  await openVaultFile(path);
  return true;
}

/** The Recent list being stepped through while Ctrl is held. */
let cycle: { files: RecentFileEntry[]; index: number; step: 1 | -1 } | null =
  null;
let opening: Promise<void> | null = null;
let nextPath: string | null = null;

/** The file on screen: the drawing in Canvas, otherwise the open shard. */
function openFilePath() {
  const { appMode, activeDrawingPath } = useUIStore.getState();
  return appMode === "canvas"
    ? activeDrawingPath
    : useEditorStore.getState().currentFilePath;
}

/** Leaves a file that's gone out of the list Ctrl+Tab is stepping through. */
function dropFromCycle(path: string) {
  if (!cycle) return;
  const at = cycle.files.findIndex((file) => isSamePath(file.path, path));
  if (at === -1) return;
  cycle.files.splice(at, 1);
  // The next step lands where it would have with the file still there.
  if (at < cycle.index || (at === cycle.index && cycle.step === 1)) {
    cycle.index -= 1;
  }
}

/**
 * Opens `path`, after any open already running; only the last one waits.
 * Settles once every open asked for so far is done.
 */
function openInTurn(path: string): Promise<void> {
  nextPath = path;
  if (opening) return opening;

  opening = (async () => {
    while (nextPath) {
      const target = nextPath;
      nextPath = null;
      try {
        if (!(await openRecentFile(target))) dropFromCycle(target);
      } catch (error) {
        console.error("[Netherstone] Failed to open recent file:", error);
      }
    }
    opening = null;
  })();
  return opening;
}

/**
 * Ctrl+Tab and Ctrl+Shift+Tab: opens the next or previous file in Recent.
 * The list stays as it was at the first press until Ctrl is let go, so
 * pressing again keeps going down it instead of swapping between two.
 * Settles once the file is open.
 */
export function stepRecentFile(step: 1 | -1): Promise<void> {
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
      step,
    };
  }

  const { files } = cycle;
  if (files.length === 0) return Promise.resolve();

  cycle.step = step;
  cycle.index = (cycle.index + step + files.length) % files.length;
  return openInTurn(files[cycle.index].path);
}

/** Ctrl let go: the next Ctrl+Tab starts from the top of Recent again. */
export function endRecentCycle() {
  cycle = null;
}
