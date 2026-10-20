import { createSlateEditor, normalizeStaticValue } from "platejs";
import {
  deserializeEditorMarkdown,
  stripDeviceMediaProps,
} from "@/lib/editor-markdown";
import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { resolveShardLinkKeys } from "@/lib/shard-link-keys";
import { useVaultStore } from "@/store";
import { EditorKit } from "../editor-kit";
import {
  formatEditorLifecycleDurationMs,
  getEditorLifecycleNowMs,
  getPlateValueNodeCount,
  logEditorLifecycle,
} from "./editor-lifecycle";

/**
 * Resolves the initial Plate value for a newly opened file: the cached AST
 * when available, otherwise markdown deserialized in the worker (falling back
 * to the main thread if the worker fails).
 */
export async function resolveSessionValue(
  filePath: string,
  content: string,
  cachedValue: any[] | null,
): Promise<any[]> {
  // Values cached before device-specific media props stopped being saved
  // may still carry them.
  if (cachedValue) return withCurrentShardLinks(filePath, stripDeviceMediaProps(cachedValue));

  const startMs = getEditorLifecycleNowMs();
  const deserializeInMainThread = () =>
    normalizeStaticValue(
      deserializeEditorMarkdown(createSlateEditor({ plugins: EditorKit }), content, {
        filePath,
      }),
    ) as any[];

  try {
    const value = await deserializeMarkdownInWorker(content, {
      filePath,
      fallback: deserializeInMainThread,
    });

    logEditorLifecycle("deserialize:complete", {
      filePath,
      nodeCount: getPlateValueNodeCount(value),
      duration: formatEditorLifecycleDurationMs(startMs),
    });

    return withCurrentShardLinks(
      filePath,
      Array.isArray(value) ? (value as any[]) : [],
    );
  } catch (error) {
    console.error("Failed to deserialize markdown in worker:", {
      filePath,
      error,
    });
    return withCurrentShardLinks(filePath, deserializeInMainThread());
  }
}

/** Points the @ links of a loaded shard at where their shards are now. */
function withCurrentShardLinks(filePath: string, value: any[]): any[] {
  const { fileTree, currentVaultPath } = useVaultStore.getState();
  return resolveShardLinkKeys(value, fileTree, filePath, currentVaultPath ?? "");
}
