import { createSlateEditor } from "platejs";

import { SerializationKit } from "@/components/editor/serialization-kit";
import { serializeMarkdownValue } from "@/lib/editor-markdown";

import { ImportError } from "../../types";
import { readWordPackage } from "./package";
import type { WorkerScope } from "./protocol";

/**
 * Reads the Word file the window sends, asking it for what only the import
 * knows (links to other imported files, where pictures were stored), and
 * writes its Markdown here too: only the Markdown goes back, so the long
 * document is never copied to the window or to another worker.
 */
export function serve(scope: WorkerScope) {
  let editor: ReturnType<typeof createSlateEditor> | undefined;
  const waiting = new Map<number, { resolve: (link: string | null) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  const ask = (send: (id: number) => void) =>
    new Promise<string | null>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      send(id);
    });

  scope.onmessage = async ({ data }) => {
    if (data.type !== "read") {
      const pending = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.type === "notStored") pending?.reject(new Error(data.error));
      else pending?.resolve(data.link);
      return;
    }
    try {
      const nodes = await readWordPackage(data.bytes, data.name, {
        warn: (message) => scope.postMessage({ type: "warn", message }),
        linkTo: (target) => ask((id) => scope.postMessage({ type: "link", id, target })),
        addAttachment: async (name, bytes) => (await ask((id) => scope.postMessage({ type: "store", id, name, bytes })))!,
      });
      editor ??= createSlateEditor({ plugins: SerializationKit });
      scope.postMessage({ type: "done", markdown: serializeMarkdownValue(editor, nodes, { filePath: data.filePath }) });
    } catch (error) {
      scope.postMessage({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
        readable: error instanceof ImportError,
      });
    }
  };
}
