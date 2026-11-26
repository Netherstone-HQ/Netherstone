import { useEffect, useState } from "react";
import { getShardPreviews, type ShardPreview } from "@/lib/commands/shards";
import { useVaultStore } from "@/store";

/** Previews of the files at `paths`, reloaded when the vault's files change. */
export function usePreviews(paths: string[]): Map<string, ShardPreview> {
  const fileTree = useVaultStore((s) => s.fileTree);
  const [previews, setPreviews] = useState(new Map<string, ShardPreview>());
  const key = paths.join("\n");

  useEffect(() => {
    if (!key) return;
    let current = true;
    getShardPreviews(key.split("\n"))
      .then((list) => {
        if (!current) return;
        // An unchanged preview keeps its object, so its row isn't drawn again.
        setPreviews((old) => {
          const kept = (p: ShardPreview) => {
            const before = old.get(p.path);
            return before?.lastModified === p.lastModified &&
              before.preview === p.preview
              ? before
              : p;
          };
          return new Map(list.map((p) => [p.path, kept(p)]));
        });
      })
      .catch((error: unknown) =>
        console.error("[Netherstone] Failed to load shard previews:", error),
      );
    return () => {
      current = false;
    };
  }, [key, fileTree]);

  return previews;
}
