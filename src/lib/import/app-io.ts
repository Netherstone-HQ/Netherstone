import { createSlateEditor } from "platejs";

import {
  fileExists,
  fixImportedLinks,
  importAttachment,
  persistAttachmentBytes,
  readImportFile,
  reserveImportPaths,
  saveImportedShard,
} from "@/lib/commands";

import type { ImportIO } from "./engine";
import type { PlateNode } from "./types";

/** How long the import's Markdown worker waits for the next shard before it stops. */
const IDLE_MS = 5_000;

type Reply = { type: "success"; requestId: number; markdown: string } | { type: "error"; requestId: number; error: string };

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextRequest = 0;
const pending = new Map<number, { resolve: (markdown: string) => void; reject: (error: Error) => void }>();

function stopWorker(error: Error) {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

/**
 * Writes the Markdown in a worker of the import's own, not the one the
 * editor shares: a long document takes a while there, and opening, saving
 * and the background reading of shards would wait behind it.
 */
function serializeInImportWorker(nodes: PlateNode[], filePath: string) {
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL("../../components/editor/serialize.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      const request = pending.get(data.requestId);
      if (!request) return;
      pending.delete(data.requestId);
      if (data.type === "success") request.resolve(data.markdown);
      else request.reject(new Error(data.error));
      if (!pending.size) idleTimer = setTimeout(() => stopWorker(new Error()), IDLE_MS);
    };
    worker.onerror = (event) => stopWorker(new Error(event.message));
  }
  const requestId = nextRequest++;
  return new Promise<string>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    worker!.postMessage({ type: "serialize", requestId, filePath, children: nodes });
  });
}

async function serializeHere(nodes: PlateNode[], filePath: string) {
  const [{ SerializationKit }, { serializeMarkdownValue }] = await Promise.all([
    import("@/components/editor/serialization-kit"),
    import("@/lib/editor-markdown"),
  ]);
  return serializeMarkdownValue(createSlateEditor({ plugins: SerializationKit }), nodes, { filePath });
}

/** The engine's IO in the app: files through the backend, Markdown in the worker. */
export function appImportIO(vaultPath: string): ImportIO {
  return {
    readFile: readImportFile,
    reservePaths: reserveImportPaths,
    saveShard: (path, markdown) => saveImportedShard(vaultPath, path, markdown),
    saveAttachment: async (name, bytes) =>
      (await persistAttachmentBytes(name, bytes, vaultPath)).assetPath,
    copyAttachment: async (path) => (await importAttachment(path, vaultPath)).assetPath,
    fixLinks: fixImportedLinks,
    exists: fileExists,
    serialize: (nodes, filePath) =>
      typeof Worker === "undefined" ? serializeHere(nodes, filePath) : serializeInImportWorker(nodes, filePath),
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}
