import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useEditorStore, useVaultStore } from "@/store";
import {
  areDocumentLinksEqual,
  flattenFiles,
  resolveDocumentLinks,
} from "./link-utils";
import type { Backlink, DocumentLink, FileMetadata } from "./types";

/** How long typing pauses before the links catch up. */
const LINKS_REFRESH_MS = 450;
/** How long the index settles before it's read again. */
const INDEX_REFRESH_MS = 300;
/** How long after a save the vault watcher's echo of it is ignored. */
const SAVE_ECHO_MS = 1500;

/** The open shard's links, kept current while it's edited. */
export function useShardLinks(isEnabled: boolean): DocumentLink[] {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const plateEditor = useEditorStore((s) => s.plateEditor);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const [links, setLinks] = useState<DocumentLink[]>([]);

  useEffect(() => {
    if (!isEnabled || !currentFilePath || !currentVaultPath || !plateEditor) {
      setLinks([]);
      return;
    }

    const vaultFiles = flattenFiles(fileTree);
    const update = () => {
      const next = resolveDocumentLinks(
        plateEditor.children,
        currentFilePath,
        currentVaultPath,
        vaultFiles,
      );
      setLinks((previous) =>
        areDocumentLinksEqual(previous, next) ? previous : next,
      );
    };
    update();

    // Subscribed here rather than selected, so typing doesn't re-render.
    let timer: number | undefined;
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.editTick === previous.editTick) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(update, LINKS_REFRESH_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [isEnabled, currentFilePath, currentVaultPath, plateEditor, fileTree]);

  return links;
}

export interface IndexedShard {
  /** Null if the shard can't be indexed. */
  details: FileMetadata | null;
  linkedFrom: Backlink[];
}

/**
 * The open shard's indexed details and the shards linking to it, read again
 * after each save and change in the vault. Null while they load.
 */
export function useIndexedShard(isEnabled: boolean): IndexedShard | null {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const [indexed, setIndexed] = useState<
    (IndexedShard & { filePath: string }) | null
  >(null);

  useEffect(() => {
    if (!isEnabled || !currentFilePath) return;

    const filePath = currentFilePath;
    let isCurrent = true;
    let latestRequest = 0;
    let timer: number | undefined;
    let ignoreChangesUntil = 0;

    const load = async () => {
      const request = ++latestRequest;
      try {
        const [details, linkedFrom] = await Promise.all([
          invoke<FileMetadata | null>("get_file_metadata", { filePath }),
          invoke<Backlink[]>("get_backlinks", { filePath }),
        ]);
        if (isCurrent && request === latestRequest) {
          setIndexed({ filePath, details, linkedFrom });
        }
      } catch (error) {
        console.error("[Netherstone] Failed to read the shard's index:", error);
        if (isCurrent && request === latestRequest) {
          setIndexed({ filePath, details: null, linkedFrom: [] });
        }
      }
    };
    const reload = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), INDEX_REFRESH_MS);
    };

    void load();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (!previous.isDirty || state.isDirty) return;
      ignoreChangesUntil = performance.now() + SAVE_ECHO_MS;
      reload();
    });
    const unlisten = listen("vault:changed", () => {
      if (performance.now() >= ignoreChangesUntil) reload();
    });

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      unsubscribe();
      void unlisten.then((stop) => stop());
    };
  }, [isEnabled, currentFilePath]);

  // Another shard's results wait out the load rather than show here.
  return indexed?.filePath === currentFilePath ? indexed : null;
}
