import { createSlateEditor } from "platejs";

import { SerializationKit } from "@/components/editor/serialization-kit";
import { serializeMarkdownValue } from "@/lib/editor-markdown";
import { encodeShardLinkPath, relativePath } from "@/lib/markdown-shard-links";
import { runImport, type ImportIO, type ImportSource } from "@/lib/import/engine";
import type { PlateNode } from "@/lib/import/types";

/**
 * An import into a vault held in memory: files to import live under `from`
 * (`/in`), the vault is `/vault/`, and attachments go in `_attachments`.
 * `disk` holds other files on disk, by absolute path, that weren't picked.
 * `dropped` imports without paths on disk, like files dropped in.
 * `takenOnSave` are shard paths something else takes between reserving
 * and saving them.
 */
export function memoryImport(
  files: Record<string, Uint8Array | string>,
  options: {
    from?: string;
    disk?: Record<string, Uint8Array | string>;
    dropped?: boolean;
    takenOnSave?: string[];
  } = {},
) {
  const encoder = new TextEncoder();
  const from = options.from ?? "/in";
  const bytesOf = (content: Uint8Array | string) => (typeof content === "string" ? encoder.encode(content) : content);
  const inputs = new Map(Object.entries(files).map(([path, content]) => [`${from}/${path}`, bytesOf(content)]));
  const disk = new Map([...inputs, ...Object.entries(options.disk ?? {}).map(([path, content]) => [path, bytesOf(content)] as const)]);
  const shards = new Map<string, string>();
  const attachments = new Map<string, Uint8Array>();
  const taken = new Set(options.takenOnSave);

  /** Files copied in by path, never read into the app. */
  const copied: string[] = [];
  const saveAttachment = async (name: string, bytes: Uint8Array) => {
    let assetPath = `_attachments/${name}`;
    for (let n = 1; attachments.has(assetPath); n += 1) assetPath = `_attachments/${name.replace(/(\.\w+)?$/, ` ${n}$1`)}`;
    attachments.set(assetPath, bytes);
    return assetPath;
  };

  const io: ImportIO = {
    readFile: async (path) => {
      const bytes = (options.dropped ? inputs : disk).get(path);
      if (!bytes) throw new Error(`No such file: ${path}`);
      return bytes;
    },
    reservePaths: async (targetDir, relativePaths) => {
      const taken = new Set(shards.keys());
      return relativePaths.map((relative) => {
        let path = `${targetDir}/${relative}.md`;
        for (let n = 1; taken.has(path); n += 1) path = `${targetDir}/${relative}_${n}.md`;
        taken.add(path);
        return path;
      });
    },
    saveShard: async (path, markdown) => {
      let savedAt = path;
      for (let n = 1; taken.has(savedAt) || shards.has(savedAt); n += 1) savedAt = path.replace(/\.md$/, `_${n}.md`);
      shards.set(savedAt, markdown);
      return savedAt;
    },
    fixLinks: async (paths, oldPath, newPath) => {
      for (const path of paths) {
        const from = `](${encodeShardLinkPath(relativePath(path, oldPath))})`;
        const to = `](${encodeShardLinkPath(relativePath(path, newPath))})`;
        shards.set(path, shards.get(path)!.replaceAll(from, to));
      }
    },
    saveAttachment,
    copyAttachment: options.dropped
      ? undefined
      : async (path) => {
          const bytes = disk.get(path);
          if (!bytes) throw new Error(`No such file: ${path}`);
          copied.push(path);
          return saveAttachment(path.slice(path.lastIndexOf("/") + 1), bytes);
        },
    exists: options.dropped
      ? undefined
      : async (path) => [...disk.keys()].some((file) => file === path || file.startsWith(`${path}/`)),
    serialize: async (nodes: PlateNode[], filePath) =>
      serializeMarkdownValue(createSlateEditor({ plugins: SerializationKit }), nodes, { filePath }),
    yield: async () => {},
  };

  const sources: ImportSource[] = [...inputs.entries()].map(([path, bytes]) => ({
    path,
    relativePath: path.slice(from.length + 1),
    size: bytes.length,
  }));

  return {
    shards,
    attachments,
    copied,
    io,
    run: (run: { signal?: AbortSignal; bringAttachments?: boolean } = {}) =>
      runImport({ sources, targetDir: "/vault", io, ...run }),
  };
}
