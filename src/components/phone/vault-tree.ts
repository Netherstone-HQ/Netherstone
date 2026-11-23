import { isDrawingPath, isSamePath } from "@/lib/drawing-files";
import type { FileTreeNode } from "@/store";

/** The folder at `path` in `tree`, or null when it's gone. */
export function findFolder(
  tree: FileTreeNode[],
  path: string,
): FileTreeNode | null {
  for (const node of tree) {
    if (node.kind !== "directory") continue;
    if (isSamePath(node.path, path)) return node;
    const inside = findFolder(node.children ?? [], path);
    if (inside) return inside;
  }
  return null;
}

/** How many shards and drawings are in `folder`, at any depth. */
export function countFiles(folder: FileTreeNode): number {
  return (folder.children ?? []).reduce(
    (count, child) =>
      count + (child.kind === "directory" ? countFiles(child) : 1),
    0,
  );
}

/** A folder's own folders and files, each by name. */
export function splitChildren(children: FileTreeNode[]) {
  const byName = (a: FileTreeNode, b: FileTreeNode) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  return {
    folders: children.filter((c) => c.kind === "directory").sort(byName),
    files: children.filter((c) => c.kind === "file").sort(byName),
  };
}

/** What a row says a file is when it has no text to show. */
export function fileKindLabel(path: string) {
  return isDrawingPath(path) ? "Drawing" : null;
}

/** `files` newest first by `modified` (seconds), unknown dates last. */
export function newestFirst<T extends { path: string }>(
  files: T[],
  modified: (path: string) => number | null | undefined,
): T[] {
  return [...files].sort(
    (a, b) => (modified(b.path) ?? -Infinity) - (modified(a.path) ?? -Infinity),
  );
}
