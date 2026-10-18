import { createSlateEditor, normalizeStaticValue } from "platejs";
import {
  deserializeEditorMarkdown,
  serializeMarkdownValue,
} from "../../lib/editor-markdown";
import { SerializationKit } from "./serialization-kit";

type SerializeWorkerRequest = {
  type: "serialize";
  requestId: number;
  filePath?: string | null;
  children: unknown;
};

type DeserializeWorkerRequest = {
  type: "deserialize";
  requestId: number;
  filePath?: string | null;
  markdown: string;
};

type MarkdownWorkerRequest = SerializeWorkerRequest | DeserializeWorkerRequest;

type SerializeWorkerSuccessResponse = {
  type: "success";
  requestId: number;
  filePath: string | null;
  markdown: string;
};

type DeserializeWorkerSuccessResponse = {
  type: "success";
  requestId: number;
  filePath: string | null;
  plateValue: unknown[];
};

type MarkdownWorkerSuccessResponse =
  | SerializeWorkerSuccessResponse
  | DeserializeWorkerSuccessResponse;

type MarkdownWorkerErrorResponse = {
  type: "error";
  requestId: number;
  filePath: string | null;
  error: string;
};

function serializeChildren(
  children: unknown[],
  filePath: string | null,
): string {
  return serializeMarkdownValue(serializerEditor, children, { filePath });
}

function deserializeMarkdown(
  markdown: string,
  filePath: string | null,
): unknown[] {
  return normalizeStaticValue(
    deserializeEditorMarkdown(deserializerEditor, markdown, { filePath }),
  ) as unknown[];
}

// Reuse a single editor instance for the lifetime of the worker.
const serializerEditor = createSlateEditor({
  plugins: SerializationKit,
});

const deserializerEditor = createSlateEditor({
  plugins: SerializationKit,
});

self.onmessage = (event: MessageEvent<MarkdownWorkerRequest>): void => {
  const requestId = event.data?.requestId ?? -1;
  const filePath =
    typeof event.data?.filePath === "string" ? event.data.filePath : null;

  try {
    if (event.data?.type === "serialize") {
      const children = Array.isArray(event.data.children)
        ? event.data.children
        : [];
      const markdown = serializeChildren(children, filePath);

      const response: MarkdownWorkerSuccessResponse = {
        type: "success",
        requestId,
        filePath,
        markdown,
      };

      self.postMessage(response);
      return;
    }

    if (event.data?.type === "deserialize") {
      const markdown =
        typeof event.data.markdown === "string" ? event.data.markdown : "";
      const plateValue = deserializeMarkdown(markdown, filePath);

      const response: MarkdownWorkerSuccessResponse = {
        type: "success",
        requestId,
        filePath,
        plateValue,
      };

      self.postMessage(response);
      return;
    }

    throw new Error("Unsupported editor markdown worker request type.");
  } catch (error) {
    const response: MarkdownWorkerErrorResponse = {
      type: "error",
      requestId,
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(response);
  }
};

export {};
