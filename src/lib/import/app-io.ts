import {
  fileExists,
  fixImportedLinks,
  importAttachment,
  persistAttachmentBytes,
  readImportFile,
  readImportFileRange,
  reserveImportPaths,
  saveImportedShard,
  vaultFreeSpace,
} from "@/lib/commands";

import type { ImportIO } from "./engine";
import { serializeImported } from "./serialize";

/** The engine's IO in the app: files through the backend, Markdown in the worker. */
export function appImportIO(vaultPath: string): ImportIO {
  return {
    readFile: readImportFile,
    readRange: readImportFileRange,
    reservePaths: reserveImportPaths,
    saveShard: (path, markdown) => saveImportedShard(vaultPath, path, markdown),
    saveAttachment: async (name, bytes) =>
      (await persistAttachmentBytes(name, bytes, vaultPath)).assetPath,
    copyAttachment: async (path) => (await importAttachment(path, vaultPath)).assetPath,
    fixLinks: fixImportedLinks,
    exists: fileExists,
    freeSpace: () => vaultFreeSpace(vaultPath),
    serialize: serializeImported,
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}
