import { KEYS, type SlateEditor, type TElement } from "platejs";

import {
  flattenShardFiles,
  resolveMentionPath,
} from "@/components/sidebar/right-sidebar/link-utils";
import { isPathWithin, remapPathAfterMove } from "@/lib/drawing-files";
import {
  cleanLegacyMentionKey,
  isAbsolutePathLike,
  normalizeSlashes,
} from "@/lib/markdown-shard-links";
import type { FileTreeNode } from "@/store";

type MentionLike = TElement & { key?: unknown; value?: unknown };

function isMention(node: unknown): node is MentionLike {
  return (
    !!node &&
    typeof node === "object" &&
    (node as { type?: unknown }).type === KEYS.mention
  );
}

/**
 * Points every @ link in a loaded value at its shard's current path, when
 * that can be told from the vault: links from older files that only carry a
 * name, relative links read without a file path, and links to a shard that
 * moved since. The value comes back as it was when nothing changed.
 */
export function resolveShardLinkKeys<T>(
  value: T,
  fileTree: FileTreeNode[],
  currentFilePath: string,
  currentVaultPath: string,
): T {
  const shardFiles = flattenShardFiles(fileTree);
  const known = new Set(
    shardFiles.map((file) => normalizeSlashes(file.path).toLowerCase()),
  );

  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let next: unknown[] | null = null;
      node.forEach((child, index) => {
        const visited = visit(child);
        if (visited !== child && !next) next = node.slice(0, index);
        next?.push(visited);
      });
      return next ?? node;
    }

    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;

    if (isMention(record)) {
      const raw =
        typeof record.key === "string" && record.key.trim()
          ? cleanLegacyMentionKey(record.key)
          : typeof record.value === "string"
            ? record.value.trim()
            : "";
      if (!raw) return node;

      const current =
        isAbsolutePathLike(raw) && known.has(normalizeSlashes(raw).toLowerCase())
          ? raw
          : (resolveMentionPath(raw, currentFilePath, currentVaultPath, shardFiles) ??
            raw);

      return current === record.key ? node : { ...record, key: current };
    }

    if (Array.isArray(record.children)) {
      const children = visit(record.children);
      return children === record.children ? node : { ...record, children };
    }

    return node;
  };

  return visit(value) as T;
}

/**
 * After `oldPath` (a shard, or a folder of shards) became `newPath`, points
 * the @ links in the open editor at the new paths, so the next save writes
 * them where the shards now are. Returns how many links changed.
 */
export function remapShardLinkKeys(
  editor: SlateEditor,
  oldPath: string,
  newPath: string,
): number {
  const changes: { at: number[]; key: string }[] = [];

  for (const [node, at] of editor.api.nodes({
    at: [],
    match: (candidate) => isMention(candidate),
  })) {
    const key = (node as MentionLike).key;
    if (typeof key !== "string" || !isAbsolutePathLike(key)) continue;
    if (!isPathWithin(key, oldPath)) continue;
    const remapped = remapPathAfterMove(key, oldPath, newPath);
    if (remapped && remapped !== key) changes.push({ at, key: remapped });
  }

  if (changes.length === 0) return 0;

  editor.tf.withoutNormalizing(() => {
    for (const change of changes) {
      editor.tf.setNodes({ key: change.key } as Partial<TElement>, {
        at: change.at,
      });
    }
  });

  return changes.length;
}
