import { invoke } from "@tauri-apps/api/core";
import type { Descendant } from "platejs";

// Bump whenever the persisted Plate value shape changes (v2: Plate 53 blockquotes hold block children).
export const AST_CACHE_VERSION = 2;

export type PlateAstValue = Descendant[];

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
  filePath: string;
  markdown: string;
  plateValue: unknown;
  cacheVersion?: number;
};

type AstCacheLogDetails = Record<string, unknown>;

const AST_CACHE_LOG_PREFIX = "[Netherstone][AST Cache]";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logAstCacheInfo(
  event: string,
  details: AstCacheLogDetails = {},
): void {
  console.info(AST_CACHE_LOG_PREFIX, event, details);
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
  options?: { cacheVersion?: number },
): Promise<OpenMarkdownFileResult> {
  assertTauri();

  const cacheVersion = options?.cacheVersion ?? AST_CACHE_VERSION;

  logAstCacheInfo("open:start", {
    filePath,
    cacheVersion,
  });

  try {
    const result = await invoke<OpenMarkdownFileCommandResult>(
      "open_markdown_file",
      {
        filePath,
        cacheVersion,
      },
    );

    const plateValue = normalizePlateValue(result.plate_value);

    logAstCacheInfo(result.cache_hit ? "open:hit" : "open:miss", {
      filePath: result.file_path,
      cacheVersion,
      contentHash: result.content_hash,
      markdownChars: result.markdown.length,
      hasPlateValue: plateValue !== null,
    });

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
      cacheVersion,
    });
    throw error;
  }
}

export async function upsertAstCache({
  filePath,
  markdown,
  plateValue,
  cacheVersion = AST_CACHE_VERSION,
}: UpsertAstCacheInput): Promise<void> {
  assertTauri();

  logAstCacheInfo("write:start", {
    filePath,
    cacheVersion,
    markdownChars: markdown.length,
    hasPlateValue: Array.isArray(plateValue),
  });

  try {
    await invoke("upsert_ast_cache", {
      filePath,
      markdown,
      cacheVersion,
      plateValue,
    });

    logAstCacheInfo("write:success", {
      filePath,
      cacheVersion,
      markdownChars: markdown.length,
      hasPlateValue: Array.isArray(plateValue),
    });
  } catch (error) {
    logAstCacheError("write:error", error, {
      filePath,
      cacheVersion,
      markdownChars: markdown.length,
      hasPlateValue: Array.isArray(plateValue),
    });
    throw error;
  }
}

export async function deleteAstCache(filePath: string): Promise<boolean> {
  assertTauri();

  logAstCacheInfo("delete:start", { filePath });

  try {
    const deleted = await invoke<boolean>("delete_ast_cache", { filePath });

    logAstCacheInfo("delete:result", {
      filePath,
      deleted,
    });

    return deleted;
  } catch (error) {
    logAstCacheError("delete:error", error, { filePath });
    throw error;
  }
}

export async function renameAstCache(
  oldPath: string,
  newPath: string,
): Promise<boolean> {
  assertTauri();

  logAstCacheInfo("rename:start", {
    oldPath,
    newPath,
  });

  try {
    const renamed = await invoke<boolean>("rename_ast_cache", {
      oldPath,
      newPath,
    });

    logAstCacheInfo("rename:result", {
      oldPath,
      newPath,
      renamed,
    });

    return renamed;
  } catch (error) {
    logAstCacheError("rename:error", error, {
      oldPath,
      newPath,
    });
    throw error;
  }
}
