import type { ImportSource } from "./engine";

/**
 * Files and folders dropped on the Import window. The app turns off Tauri's
 * own file drop so blocks can be dragged in the editor, so drops arrive as
 * browser files without paths on disk. They are read in the window instead
 * of through the backend, under made-up paths only this module understands.
 */
export interface DroppedFiles {
  sources: ImportSource[];
  read(path: string): Promise<Uint8Array>;
}

type Entry = FileSystemEntry | File;

/** Whether a drag carries files from outside the app. */
export function carriesFiles(dataTransfer: DataTransfer | null) {
  return !!dataTransfer && Array.from(dataTransfer.types).includes("Files");
}

/**
 * Every file in what was dropped, folders walked like the backend walks
 * picked ones: sorted by name, hidden entries and `node_modules` left out.
 * Must be called while the drop event is being handled; the browser empties
 * `dataTransfer` once it returns.
 */
export function readDrop(dataTransfer: DataTransfer): Promise<DroppedFiles> {
  const entries: Entry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    const file = entry ? null : item.getAsFile();
    if (entry) entries.push(entry);
    else if (file) entries.push(file);
  }
  return collect(entries);
}

async function collect(entries: Entry[]): Promise<DroppedFiles> {
  const files = new Map<string, File>();
  const sources: ImportSource[] = [];
  const add = (file: File, relativePath: string) => {
    const path = `dropped:${sources.length}/${relativePath}`;
    files.set(path, file);
    sources.push({ path, relativePath, size: file.size });
  };

  const walk = async (entry: FileSystemEntry, relativePath: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (file) add(file, relativePath);
      return;
    }
    if (!entry.isDirectory) return;
    const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
    children.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const child of children) {
      if (child.name.startsWith(".") || child.name === "node_modules") continue;
      await walk(child, `${relativePath}/${child.name}`);
    }
  };

  for (const entry of entries) {
    if (entry instanceof File) add(entry, entry.name);
    else await walk(entry, entry.name);
  }

  return {
    sources,
    read: async (path) => {
      const file = files.get(path);
      if (!file) throw new Error(`Not a dropped file: ${path}`);
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}

/** A folder's entries; browsers hand them over a batch at a time. */
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) return all;
    all.push(...batch);
  }
}
