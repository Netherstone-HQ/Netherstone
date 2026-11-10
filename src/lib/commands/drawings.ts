import { invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

/** Reads the raw JSON of a `.excalidraw` drawing in the vault. */
export async function readDrawingFile(filePath: string): Promise<string> {
  assertTauri();
  return invoke<string>("read_drawing_file", { filePath });
}

/**
 * Atomically writes a `.excalidraw` drawing's JSON. With `expectedContent`,
 * the drawing as the app last read or wrote it, the save is refused if the
 * file changed outside the app since (see `isChangedOnDiskError`).
 */
export async function saveDrawingFile(
  filePath: string,
  content: string,
  expectedContent?: string,
): Promise<void> {
  assertTauri();
  return invoke("save_drawing_file", { filePath, content, expectedContent });
}

export type MergedDrawing = {
  content: string;
  /** A shape changed on both sides; ours was kept. */
  conflicted: boolean;
};

/**
 * Merges `ours` and `theirs`, two versions of the drawing `base`, shape by
 * shape. Null when one of them isn't a drawing.
 */
export async function mergeDrawings(
  base: string,
  ours: string,
  theirs: string,
): Promise<MergedDrawing | null> {
  assertTauri();
  return invoke<MergedDrawing | null>("merge_drawings", { base, ours, theirs });
}

/**
 * Creates an empty drawing called `name` in `directory`, adding a numeric
 * suffix if the name is taken. Returns the new file's path.
 */
export async function createDrawingFile(
  directory: string,
  name: string,
): Promise<string> {
  assertTauri();
  return invoke<string>("create_drawing_file", { directory, name });
}

/**
 * Returns the shards in the vault whose text contains any of `needles`, such
 * as the notes that embed an exported drawing.
 */
export async function findShardsContaining(
  vaultPath: string,
  needles: string[],
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("find_shards_containing", { vaultPath, needles });
}

/** A drawing a shard shows, with the files its pictures point at. */
export interface DrawingPictures {
  drawingPath: string;
  /** null where a picture has no source or it isn't a file. */
  imagePaths: (string | null)[];
}

/**
 * Returns the drawings among `drawings` that have a picture missing or older
 * than the drawing. Drawings that don't exist are left out.
 */
export async function staleDrawingPictures(
  vaultPath: string,
  drawings: DrawingPictures[],
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("stale_drawing_pictures", { vaultPath, drawings });
}

/**
 * Moves the drawing pictures no shard uses any more to the Trash, such as
 * the ones a new export just replaced. Returns their paths in the vault.
 */
export async function removeUnusedDrawingPictures(
  vaultPath: string,
): Promise<string[]> {
  assertTauri();
  return invoke<string[]>("remove_unused_drawing_pictures", { vaultPath });
}
