import { createSlateEditor } from "platejs";

import {
  persistAttachmentBytes,
  readImportFile,
  reserveImportPaths,
  saveImportedShard,
} from "@/lib/commands";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";

import type { ImportIO } from "./engine";

/** The engine's IO in the app: files through the backend, Markdown in the worker. */
export function appImportIO(vaultPath: string): ImportIO {
  return {
    readFile: readImportFile,
    reservePaths: reserveImportPaths,
    saveShard: (path, markdown) => saveImportedShard(vaultPath, path, markdown),
    saveAttachment: async (name, bytes) =>
      (await persistAttachmentBytes(name, bytes, vaultPath)).assetPath,
    serialize: (nodes, filePath) =>
      serializeMarkdownInWorker(nodes, {
        filePath,
        requestKey: `import:${filePath}`,
        // Long documents take a while; the person can cancel instead.
        timeoutMs: 120_000,
        fallback: async () => {
          const [{ SerializationKit }, { serializeMarkdownValue }] = await Promise.all([
            import("@/components/editor/serialization-kit"),
            import("@/lib/editor-markdown"),
          ]);
          return serializeMarkdownValue(createSlateEditor({ plugins: SerializationKit }), nodes, { filePath });
        },
      }),
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}
