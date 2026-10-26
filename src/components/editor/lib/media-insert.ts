"use client";

import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Path } from "platejs";
import { KEYS, PathApi } from "platejs";
import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  persistAttachmentBytes,
  type PersistedAttachment,
} from "@/lib/commands";
import { useEditorStore, useVaultStore } from "@/store";
import type { PlateEditor } from "platejs/react";

const LOG_PREFIX = "[media-insert]";

export type LocalMediaNodeType =
  | typeof KEYS.audio
  | typeof KEYS.file
  | typeof KEYS.img
  | typeof KEYS.video;

const LOCAL_MEDIA_NODE_TYPES = new Set<LocalMediaNodeType>([
  KEYS.audio,
  KEYS.file,
  KEYS.img,
  KEYS.video,
]);

type LocalMediaTextNode = { text: string };

export type LocalMediaNode = {
  children: LocalMediaTextNode[];
  name?: string;
  type: LocalMediaNodeType;
  url: string;
  netherstoneSourceKind?: "vault";
  netherstoneStoredSource?: string;
  netherstoneOriginalPath?: string;
  netherstoneImportedPath?: string;
  netherstoneRenderUrl?: string;
};

export type LocalMediaFileInput =
  | FileList
  | File[]
  | readonly File[]
  | null
  | undefined;

export type InsertLocalMediaFilesOptions = {
  at?: Path;
  preferredType?: LocalMediaNodeType | string;
  select?: boolean;
};

export type InsertLocalMediaFilesResult = {
  insertedCount: number;
  nodes: LocalMediaNode[];
};

export type InsertManagedMediaFilesResult =
  Promise<InsertLocalMediaFilesResult>;

function canUseTauriConvertFileSrc(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

function toRenderableLocalUrl(filePath: string): string {
  if (!filePath || !canUseTauriConvertFileSrc()) return filePath;

  try {
    return convertFileSrc(filePath);
  } catch {
    return filePath;
  }
}

function errorLog(message: string, details?: unknown) {
  if (typeof details === "undefined") {
    console.error(LOG_PREFIX, message);
    return;
  }

  console.error(LOG_PREFIX, message, details);
}

export function isLocalMediaNodeType(
  value: string | null | undefined,
): value is LocalMediaNodeType {
  return !!value && LOCAL_MEDIA_NODE_TYPES.has(value as LocalMediaNodeType);
}

export function normalizeLocalMediaFiles(files: LocalMediaFileInput): File[] {
  if (!files) return [];

  return Array.from(files);
}

export function getLocalMediaNodeTypeForFile(
  file: File,
  preferredType?: LocalMediaNodeType | string,
): LocalMediaNodeType {
  if (isLocalMediaNodeType(preferredType)) {
    return preferredType;
  }

  const mime = file.type.toLowerCase();

  if (mime.startsWith("image/")) return KEYS.img;
  if (mime.startsWith("video/")) return KEYS.video;
  if (mime.startsWith("audio/")) return KEYS.audio;

  return KEYS.file;
}

async function createManagedMediaNode(
  file: File,
  options: Pick<InsertLocalMediaFilesOptions, "preferredType">,
): Promise<{ node: LocalMediaNode; attachment: PersistedAttachment }> {
  const currentVaultPath = useVaultStore.getState().currentVaultPath;
  const currentFilePath = useEditorStore.getState().currentFilePath;

  if (!currentVaultPath) {
    throw new Error("Open a vault before attaching files.");
  }
  if (!currentFilePath) {
    throw new Error("Open a shard before attaching files.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const persisted = await persistAttachmentBytes(
    file.name,
    bytes,
    currentVaultPath,
  );
  const type = getLocalMediaNodeTypeForFile(file, options.preferredType);
  const renderUrl = toRenderableLocalUrl(persisted.absolutePath);

  const node: LocalMediaNode = {
    children: [{ text: "" }],
    name: type === KEYS.file ? persisted.originalName : undefined,
    type,
    url: persisted.assetPath,
    netherstoneSourceKind: "vault",
    netherstoneStoredSource: persisted.assetPath,
    netherstoneOriginalPath: file.name,
    netherstoneImportedPath: persisted.absolutePath,
    netherstoneRenderUrl: renderUrl,
  };
  return { node, attachment: persisted };
}

function insertMediaNodes(
  editor: PlateEditor,
  nodes: LocalMediaNode[],
  options: Pick<InsertLocalMediaFilesOptions, "at" | "select"> = {},
) {
  let nextPath = options.at;

  editor.tf.withoutNormalizing(() => {
    nodes.forEach((node, index) => {
      const insertOptions = nextPath
        ? {
            at: nextPath,
            select: options.select === true && index === nodes.length - 1,
          }
        : options.select === true && index === nodes.length - 1
          ? { select: true }
          : undefined;

      editor.tf.insertNodes(node, insertOptions);

      if (nextPath) {
        nextPath = PathApi.next(nextPath);
      }
    });
  });
}

export async function insertManagedMediaFiles(
  editor: PlateEditor,
  files: LocalMediaFileInput,
  options: InsertLocalMediaFilesOptions = {},
): InsertManagedMediaFilesResult {
  const normalizedFiles = normalizeLocalMediaFiles(files);

  if (normalizedFiles.length === 0) {
    return { insertedCount: 0, nodes: [] };
  }

  let nodes: LocalMediaNode[] = [];

  try {
    const created = await Promise.all(
      normalizedFiles.map((file) =>
        createManagedMediaNode(file, { preferredType: options.preferredType }),
      ),
    );
    nodes = created.map(({ node }) => node);

    insertMediaNodes(editor, nodes, options);

    notifyAttachmentSyncStatus(created.map(({ attachment }) => attachment));

    return {
      insertedCount: nodes.length,
      nodes,
    };
  } catch (error) {
    errorLog("Failed to insert managed media files", {
      error,
      fileCount: normalizedFiles.length,
      preferredType: options.preferredType,
    });

    throw error;
  }
}
