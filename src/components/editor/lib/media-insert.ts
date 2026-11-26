import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { Path } from "platejs";
import { KEYS, PathApi } from "platejs";
import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  persistAttachmentBytes,
  type PersistedAttachment,
} from "@/lib/commands/attachments";
import { useEditorStore, useVaultStore } from "@/store";
import type { PlateEditor } from "platejs/react";

const LOG_PREFIX = "[media-insert]";

type LocalMediaNodeType =
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

type LocalMediaNode = {
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

type InsertLocalMediaFilesResult = {
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

function isLocalMediaNodeType(
  value: string | null | undefined,
): value is LocalMediaNodeType {
  return !!value && LOCAL_MEDIA_NODE_TYPES.has(value as LocalMediaNodeType);
}

function normalizeLocalMediaFiles(files: LocalMediaFileInput): File[] {
  if (!files) return [];

  return Array.from(files);
}

function getLocalMediaNodeTypeForFile(
  file: File,
  preferredType?: LocalMediaNodeType | string,
): LocalMediaNodeType {
  if (isLocalMediaNodeType(preferredType)) {
    return preferredType;
  }

  return mediaNodeTypeForMime(file.type);
}

/** The block a file of MIME type `mime` becomes. */
export function mediaNodeTypeForMime(mime: string): LocalMediaNodeType {
  const type = mime.toLowerCase();
  if (type.startsWith("image/")) return KEYS.img;
  if (type.startsWith("video/")) return KEYS.video;
  if (type.startsWith("audio/")) return KEYS.audio;
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
  const node = managedMediaNode(persisted, type, file.name);
  return { node, attachment: persisted };
}

/** The block for a file just stored in the vault. */
export function managedMediaNode(
  persisted: PersistedAttachment,
  type: LocalMediaNodeType,
  originalPath: string,
): LocalMediaNode {
  return {
    children: [{ text: "" }],
    name: type === KEYS.file ? persisted.originalName : undefined,
    type,
    url: persisted.assetPath,
    netherstoneSourceKind: "vault",
    netherstoneStoredSource: persisted.assetPath,
    netherstoneOriginalPath: originalPath,
    netherstoneImportedPath: persisted.absolutePath,
    netherstoneRenderUrl: toRenderableLocalUrl(persisted.absolutePath),
  };
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
