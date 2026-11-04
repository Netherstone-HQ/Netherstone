import { invoke } from "@tauri-apps/api/core";
import type { Descendant } from "platejs";
import type { ShardCache } from "@/lib/editor-markdown-worker";
import { useVaultStore } from "@/store/vault";

type PlateAstValue = Descendant[];

type OpenMarkdownFileCommandResult = {
  file_path: string;
  markdown: string;
  content_hash: string;
  cache_hit: boolean;
  plate_value?: unknown;
};

export type OpenMarkdownFileResult = {
  filePath: string;
  markdown: string;
  contentHash: string;
  cacheHit: boolean;
  plateValue: PlateAstValue | null;
};

export type UpsertAstCacheInput = {
  /** The vault the shard is in. Defaults to the open vault. */
  vaultPath?: string;
  filePath: string;
  markdown: string;
  plateValue: unknown;
};

type AstCacheLogDetails = Record<string, unknown>;

const AST_CACHE_LOG_PREFIX = "[Netherstone][AST Cache]";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logAstCacheError(
  event: string,
  error: unknown,
  details: AstCacheLogDetails = {},
): void {
  console.error(AST_CACHE_LOG_PREFIX, event, {
    ...details,
    error: getErrorMessage(error),
  });
}

function assertTauri(): void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error(
      "[Netherstone] Tauri internals not found.\n" +
        "Run the app with `pnpm tauri dev`, not `pnpm dev`.\n" +
        "Tauri commands are only available inside the native webview.",
    );
  }
}

function normalizePlateValue(value: unknown): PlateAstValue | null {
  return Array.isArray(value) ? (value as PlateAstValue) : null;
}

export async function openMarkdownFile(
  filePath: string,
): Promise<OpenMarkdownFileResult> {
  assertTauri();
  try {
    const result = await invoke<OpenMarkdownFileCommandResult>(
      "open_markdown_file",
      { filePath },
    );

    const plateValue = normalizePlateValue(result.plate_value);

    return {
      filePath: result.file_path,
      markdown: result.markdown,
      contentHash: result.content_hash,
      cacheHit: result.cache_hit,
      plateValue,
    };
  } catch (error) {
    logAstCacheError("open:error", error, {
      filePath,
    });
    throw error;
  }
}

/**
 * Writes a save's editor cache entry made by the markdown worker, as raw
 * bytes, so nothing turns the value into JSON on this thread.
 */
export async function writeShardCache(
  vaultPath: string,
  filePath: string,
  cache: ShardCache,
): Promise<void> {
  assertTauri();
  try {
    await invoke("write_shard_cache", cache.body, {
      headers: {
        "x-vault-path": encodeURIComponent(vaultPath),
        "x-file-path": encodeURIComponent(filePath),
        "x-markdown-bytes": String(cache.markdownBytes),
      },
    });
  } catch (error) {
    logAstCacheError("write:error", error, {
      filePath,
      bytes: cache.body.length,
    });
    throw error;
  }
}

export async function upsertAstCache({
  vaultPath = useVaultStore.getState().currentVaultPath ?? undefined,
  filePath,
  markdown,
  plateValue,
}: UpsertAstCacheInput): Promise<void> {
  assertTauri();
  try {
    if (!vaultPath) throw new Error("No vault is open");
    await invoke("upsert_ast_cache", {
      vaultPath,
      filePath,
      markdown,
      plateValue,
    });
  } catch (error) {
    logAstCacheError("write:error", error, {
      filePath,
      markdownChars: markdown.length,
      hasPlateValue: Array.isArray(plateValue),
    });
    throw error;
  }
}
