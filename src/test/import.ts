import { createSlateEditor } from "platejs";

import { SerializationKit } from "@/components/editor/serialization-kit";
import { serializeMarkdownValue } from "@/lib/editor-markdown";
import { runImport, type ImportIO, type ImportSource } from "@/lib/import/engine";
import type { PlateNode } from "@/lib/import/types";

/**
 * An import into a vault held in memory: files to import live under
 * `/in/`, the vault is `/vault/`, and attachments go in `_attachments`.
 */
export function memoryImport(files: Record<string, Uint8Array | string>) {
  const encoder = new TextEncoder();
  const inputs = new Map(
    Object.entries(files).map(([path, content]) => [
      `/in/${path}`,
      typeof content === "string" ? encoder.encode(content) : content,
    ]),
  );
  const shards = new Map<string, string>();
  const attachments = new Map<string, Uint8Array>();

  const io: ImportIO = {
    readFile: async (path) => {
      const bytes = inputs.get(path);
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
      shards.set(path, markdown);
    },
    saveAttachment: async (name, bytes) => {
      let assetPath = `_attachments/${name}`;
      for (let n = 1; attachments.has(assetPath); n += 1) assetPath = `_attachments/${name.replace(/(\.\w+)?$/, ` ${n}$1`)}`;
      attachments.set(assetPath, bytes);
      return assetPath;
    },
    serialize: async (nodes: PlateNode[], filePath) =>
      serializeMarkdownValue(createSlateEditor({ plugins: SerializationKit }), nodes, { filePath }),
    yield: async () => {},
  };

  const sources: ImportSource[] = [...inputs.entries()].map(([path, bytes]) => ({
    path,
    relativePath: path.slice("/in/".length),
    size: bytes.length,
  }));

  return {
    shards,
    attachments,
    io,
    run: (options: { signal?: AbortSignal } = {}) =>
      runImport({ sources, targetDir: "/vault", io, signal: options.signal }),
  };
}
