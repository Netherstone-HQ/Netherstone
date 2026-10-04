"use client";

import * as React from "react";

import { KEYS } from "platejs";
import { useEditorRef, useReadOnly } from "platejs/react";
import { toast } from "sonner";

import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  openMediaFilesDialog,
  persistAttachmentFile,
  type MediaDialogKind,
} from "@/lib/commands";
import {
  isAbsoluteFilesystemPath,
  normalizeMediaSourceValue,
  resolveMediaRenderUrl,
} from "@/lib/media-source";
import { useEditorStore, useVaultStore } from "@/store";

import type { PersistedMediaElementBase } from "./media-types";

export type PersistedMediaElement = PersistedMediaElementBase;

export type MediaNodeActionPatch = Partial<PersistedMediaElement>;

export interface UseMediaNodeActionsOptions<
  TElement extends PersistedMediaElement,
> {
  element: TElement;
  mediaKind?: MediaDialogKind;
  onAfterChange?: (patch: MediaNodeActionPatch) => void;
  onAfterRemove?: () => void;
}

export interface MediaNodeActionsResult {
  canEdit: boolean;
  canImportToVault: boolean;
  canLinkOriginalFile: boolean;
  canRelinkLocalFile: boolean;
  canRelinkVaultAttachment: boolean;
  isBusy: boolean;
  removeNode: () => void;
  relinkLocalFile: () => Promise<void>;
  relinkVaultAttachment: () => Promise<void>;
  relinkVaultAttachmentTo: (sourcePath: string) => Promise<void>;
  importToVault: () => Promise<void>;
  convertToLocalReference: () => Promise<void>;
}

function getDialogKindFromNodeType(nodeType: string): MediaDialogKind {
  switch (nodeType) {
    case KEYS.audio:
      return "audio";
    case KEYS.img:
      return "image";
    case KEYS.video:
      return "video";
    case KEYS.file:
    default:
      return "file";
  }
}

function getPathBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSegment = normalized.split("/").pop();

  return lastSegment && lastSegment.length > 0 ? lastSegment : filePath;
}

function shouldPersistName(element: PersistedMediaElement): boolean {
  return (
    element.type === KEYS.file ||
    typeof element.name === "string" ||
    typeof element.name === "undefined"
  );
}

function getReplacementSuccessLabel(element: PersistedMediaElement): string {
  switch (element.type) {
    case KEYS.img:
      return "Image updated";
    case KEYS.audio:
      return "Audio updated";
    case KEYS.video:
      return "Video updated";
    case KEYS.file:
    default:
      return "File updated";
  }
}

function getImportSuccessLabel(element: PersistedMediaElement): string {
  switch (element.type) {
    case KEYS.img:
      return "Image imported into vault";
    case KEYS.audio:
      return "Audio imported into vault";
    case KEYS.video:
      return "Video imported into vault";
    case KEYS.file:
    default:
      return "File imported into vault";
  }
}

function getMediaSourceCandidates(element: PersistedMediaElement): string[] {
  const candidates = [
    element.netherstoneOriginalPath,
    element.netherstoneStoredSource,
    element.url,
    element.netherstoneImportedPath,
  ];

  return candidates
    .map((value) => normalizeMediaSourceValue(value))
    .filter(
      (value, index, array) =>
        value.length > 0 && array.indexOf(value) === index,
    );
}

function getAbsoluteLocalSourceCandidate(
  element: PersistedMediaElement,
): string | null {
  for (const candidate of getMediaSourceCandidates(element)) {
    if (isAbsoluteFilesystemPath(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildLocalReferencePatch(
  element: PersistedMediaElement,
  sourcePath: string,
  shardPath?: string,
): MediaNodeActionPatch {
  const namePatch = shouldPersistName(element)
    ? { name: getPathBaseName(sourcePath) }
    : {};

  return {
    ...namePatch,
    url: sourcePath,
    netherstoneSourceKind: "local",
    netherstoneInsertionMethod: "manual-relink",
    netherstoneStoredSource: sourcePath,
    netherstoneOriginalPath: sourcePath,
    netherstoneImportedPath: undefined,
    netherstoneShardPath: normalizeMediaSourceValue(shardPath) || undefined,
    netherstoneRenderUrl: resolveMediaRenderUrl(sourcePath),
    netherstoneMissing: false,
  };
}

async function buildVaultImportPatch(
  element: PersistedMediaElement,
  sourcePath: string,
  vaultPath: string,
  shardPath: string,
): Promise<MediaNodeActionPatch> {
  const persisted = await persistAttachmentFile(sourcePath, vaultPath);
  const namePatch = shouldPersistName(element)
    ? { name: getPathBaseName(sourcePath) }
    : {};

  return {
    ...namePatch,
    url: persisted.assetPath,
    netherstoneSourceKind: "vault",
    netherstoneInsertionMethod: "manual-import",
    netherstoneStoredSource: persisted.assetPath,
    netherstoneOriginalPath: sourcePath,
    netherstoneImportedPath: persisted.absolutePath,
    netherstoneShardPath: shardPath,
    netherstoneVaultPath: vaultPath,
    netherstoneRenderUrl: resolveMediaRenderUrl(persisted.assetPath, {
      vaultPath,
    }),
    netherstoneMissing: false,
    netherstoneExtension: persisted.extension,
    netherstoneSizeBytes: persisted.sizeBytes,
    netherstoneSyncStatus: persisted.syncStatus,
  };
}

async function pickSingleMediaPath(
  mediaKind: MediaDialogKind,
): Promise<string | null> {
  const selectedPaths = await openMediaFilesDialog(mediaKind);
  const pickedPath = selectedPaths[0];

  return pickedPath && pickedPath.trim().length > 0 ? pickedPath : null;
}

export function useMediaNodeActions<TElement extends PersistedMediaElement>({
  element,
  mediaKind,
  onAfterChange,
  onAfterRemove,
}: UseMediaNodeActionsOptions<TElement>): MediaNodeActionsResult {
  const editor = useEditorRef();
  const readOnly = useReadOnly();
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const [isBusy, setIsBusy] = React.useState(false);

  const effectiveMediaKind =
    mediaKind ?? getDialogKindFromNodeType(element.type);

  const updateCurrentNode = React.useCallback(
    (patch: MediaNodeActionPatch) => {
      const path = editor.api.findPath(element as never);
      if (!path) {
        throw new Error(
          "This media node is no longer available in the editor.",
        );
      }

      editor.tf.setNodes(patch, { at: path });
      onAfterChange?.(patch);
    },
    [editor, element, onAfterChange],
  );

  const runAction = React.useCallback(
    async (action: () => Promise<void>) => {
      if (readOnly || isBusy) return;

      setIsBusy(true);

      try {
        await action();
      } finally {
        setIsBusy(false);
      }
    },
    [isBusy, readOnly],
  );

  const removeNode = React.useCallback(() => {
    if (readOnly) return;

    const path = editor.api.findPath(element as never);
    if (!path) return;

    editor.tf.removeNodes({ at: path });
    onAfterRemove?.();
  }, [editor, element, onAfterRemove, readOnly]);

  const relinkLocalFile = React.useCallback(async () => {
    await runAction(async () => {
      const replacementPath = await pickSingleMediaPath(effectiveMediaKind);
      if (!replacementPath) return;

      const patch = buildLocalReferencePatch(
        element,
        replacementPath,
        currentFilePath ?? element.netherstoneShardPath,
      );
      updateCurrentNode(patch);

      toast.success(getReplacementSuccessLabel(element), {
        description: getPathBaseName(replacementPath),
      });
    });
  }, [
    currentFilePath,
    effectiveMediaKind,
    element,
    runAction,
    updateCurrentNode,
  ]);

  const relinkVaultAttachmentTo = React.useCallback(
    async (sourcePath: string | null) => {
      await runAction(async () => {
        if (!currentVaultPath) {
          throw new Error("Open a vault before relinking vault attachments.");
        }
        if (!currentFilePath) {
          throw new Error("Open a shard before relinking vault attachments.");
        }

        const replacementPath =
          sourcePath ?? (await pickSingleMediaPath(effectiveMediaKind));
        if (!replacementPath) return;

        const patch = await buildVaultImportPatch(
          element,
          replacementPath,
          currentVaultPath,
          currentFilePath,
        );

        updateCurrentNode(patch);
        notifyAttachmentSyncStatus([patch]);

        toast.success(getReplacementSuccessLabel(element), {
          description: getPathBaseName(replacementPath),
        });
      });
    },
    [
      currentFilePath,
      currentVaultPath,
      effectiveMediaKind,
      element,
      runAction,
      updateCurrentNode,
    ],
  );

  const relinkVaultAttachment = React.useCallback(
    () => relinkVaultAttachmentTo(null),
    [relinkVaultAttachmentTo],
  );

  const importToVault = React.useCallback(async () => {
    await runAction(async () => {
      if (!currentVaultPath) {
        throw new Error("Open a vault before importing attachments.");
      }
      if (!currentFilePath) {
        throw new Error("Open a shard before importing attachments.");
      }

      const existingLocalPath = getAbsoluteLocalSourceCandidate(element);
      const sourcePath =
        existingLocalPath ?? (await pickSingleMediaPath(effectiveMediaKind));

      if (!sourcePath) return;

      const patch = await buildVaultImportPatch(
        element,
        sourcePath,
        currentVaultPath,
        currentFilePath,
      );
      updateCurrentNode(patch);
      notifyAttachmentSyncStatus([patch]);

      toast.success(getImportSuccessLabel(element), {
        description: getPathBaseName(sourcePath),
      });
    });
  }, [
    currentFilePath,
    currentVaultPath,
    effectiveMediaKind,
    element,
    runAction,
    updateCurrentNode,
  ]);

  const convertToLocalReference = React.useCallback(async () => {
    await runAction(async () => {
      const originalPath =
        normalizeMediaSourceValue(element.netherstoneOriginalPath) ||
        getAbsoluteLocalSourceCandidate(element) ||
        (await pickSingleMediaPath(effectiveMediaKind));

      if (!originalPath) return;

      const patch = buildLocalReferencePatch(
        element,
        originalPath,
        currentFilePath ?? element.netherstoneShardPath,
      );
      updateCurrentNode(patch);

      toast.success("Linked original file", {
        description: getPathBaseName(originalPath),
      });
    });
  }, [
    currentFilePath,
    effectiveMediaKind,
    element,
    runAction,
    updateCurrentNode,
  ]);

  const canImportToVault = !readOnly && !!currentVaultPath && !!currentFilePath;
  const canLinkOriginalFile =
    !readOnly &&
    (!!normalizeMediaSourceValue(element.netherstoneOriginalPath) ||
      !!getAbsoluteLocalSourceCandidate(element) ||
      !!currentFilePath);
  const canRelinkLocalFile = !readOnly;
  const canRelinkVaultAttachment =
    !readOnly && !!currentVaultPath && !!currentFilePath;

  return {
    canEdit: !readOnly,
    canImportToVault,
    canLinkOriginalFile,
    canRelinkLocalFile,
    canRelinkVaultAttachment,
    isBusy,
    removeNode,
    relinkLocalFile,
    relinkVaultAttachment,
    relinkVaultAttachmentTo,
    importToVault,
    convertToLocalReference,
  };
}

export default useMediaNodeActions;
