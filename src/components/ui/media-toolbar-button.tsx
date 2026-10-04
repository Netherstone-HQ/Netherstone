"use client";

import * as React from "react";

import type { DropdownMenuProps } from "@radix-ui/react-dropdown-menu";

import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  AudioLinesIcon,
  FileUpIcon,
  FilmIcon,
  ImageIcon,
  LinkIcon,
} from "lucide-react";
import { isUrl, KEYS, type TElement } from "platejs";
import { useEditorRef } from "platejs/react";
import { toast } from "sonner";

import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  openMediaFilesDialog,
  persistAttachmentFile,
  type MediaDialogKind,
} from "@/lib/commands";
import { useEditorStore, useSettingsStore, useVaultStore } from "@/store";
import type { MediaInsertionPreference } from "@/store/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import {
  ToolbarSplitButton,
  ToolbarSplitButtonPrimary,
  ToolbarSplitButtonSecondary,
} from "./toolbar";
import type { WithPersistedMediaMetadata } from "./media-types";

export type LocalMediaSourceKind = "vault" | "local";
export type MediaInsertionMethod = "toolbar-upload" | "toolbar-url";

export type TaggedMediaNode = TElement &
  WithPersistedMediaMetadata<{
    children: { text: string }[];
    name?: string;
    type: string;
    url: string;
  }> & {
    netherstoneSourceKind: "remote" | LocalMediaSourceKind;
    netherstoneInsertionMethod: MediaInsertionMethod;
  };

const MEDIA_CONFIG: Record<
  string,
  {
    acceptLabel: string;
    dialogKind: MediaDialogKind;
    icon: React.ReactNode;
    title: string;
    tooltip: string;
  }
> = {
  [KEYS.audio]: {
    acceptLabel: "Audio",
    dialogKind: "audio",
    icon: <AudioLinesIcon className="size-4" />,
    title: "Insert Audio",
    tooltip: "Audio",
  },
  [KEYS.file]: {
    acceptLabel: "File",
    dialogKind: "file",
    icon: <FileUpIcon className="size-4" />,
    title: "Insert File",
    tooltip: "File",
  },
  [KEYS.img]: {
    acceptLabel: "Image",
    dialogKind: "image",
    icon: <ImageIcon className="size-4" />,
    title: "Insert Image",
    tooltip: "Image",
  },
  [KEYS.video]: {
    acceptLabel: "Video",
    dialogKind: "video",
    icon: <FilmIcon className="size-4" />,
    title: "Insert Video",
    tooltip: "Video",
  },
};

function canUseTauriConvertFileSrc(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

function toRenderableLocalUrl(filePath: string): string {
  if (!filePath) return filePath;

  if (!canUseTauriConvertFileSrc()) {
    return filePath;
  }

  try {
    return convertFileSrc(filePath);
  } catch (error) {
    console.warn(
      "[media-toolbar] Failed to convert local file path into a render URL",
      {
        error,
        filePath,
      },
    );

    return filePath;
  }
}

function getPathBaseName(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const lastSegment = normalizedPath.split("/").pop();

  return lastSegment && lastSegment.length > 0 ? lastSegment : filePath;
}

function getFileNodeName(
  nodeType: string,
  filePath: string,
): string | undefined {
  return nodeType === KEYS.file ? getPathBaseName(filePath) : undefined;
}

function getUploadActionLabel(preference: MediaInsertionPreference): string {
  return preference === "vault-import"
    ? "Upload from computer"
    : "Link original file";
}

export function buildTaggedRemoteNode({
  nodeType,
  url,
  currentFilePath,
}: {
  nodeType: string;
  url: string;
  currentFilePath?: string | null;
}): TaggedMediaNode {
  return {
    children: [{ text: "" }],
    name: nodeType === KEYS.file ? url.split("/").pop() : undefined,
    type: nodeType,
    url,
    netherstoneSourceKind: "remote",
    netherstoneInsertionMethod: "toolbar-url",
    netherstoneStoredSource: url,
    netherstoneShardPath: currentFilePath ?? undefined,
    netherstoneRenderUrl: url,
    netherstoneMissing: false,
  };
}

export async function buildTaggedNativePathNode({
  sourcePath,
  nodeType,
  mediaInsertionPreference,
  currentVaultPath,
  currentFilePath,
}: {
  sourcePath: string;
  nodeType: string;
  mediaInsertionPreference: MediaInsertionPreference;
  currentVaultPath: string | null;
  currentFilePath: string | null;
}): Promise<TaggedMediaNode> {
  if (mediaInsertionPreference === "vault-import") {
    if (!currentVaultPath) {
      throw new Error("Open a vault before importing attachments.");
    }
    if (!currentFilePath) {
      throw new Error("Open a shard before importing attachments.");
    }

    const persisted = await persistAttachmentFile(sourcePath, currentVaultPath);
    const importedPath = persisted.absolutePath;
    const attachmentReference = persisted.assetPath;
    const renderUrl = toRenderableLocalUrl(importedPath);

    return {
      children: [{ text: "" }],
      name: getFileNodeName(nodeType, sourcePath),
      type: nodeType,
      url: attachmentReference,
      netherstoneSourceKind: "vault",
      netherstoneInsertionMethod: "toolbar-upload",
      netherstoneStoredSource: attachmentReference,
      netherstoneOriginalPath: sourcePath,
      netherstoneImportedPath: importedPath,
      netherstoneShardPath: currentFilePath ?? undefined,
      netherstoneVaultPath: currentVaultPath,
      netherstoneRenderUrl: renderUrl,
      netherstoneMissing: false,
      netherstoneExtension: persisted.extension,
      netherstoneSizeBytes: persisted.sizeBytes,
      netherstoneSyncStatus: persisted.syncStatus,
    };
  }

  const renderUrl = toRenderableLocalUrl(sourcePath);

  return {
    children: [{ text: "" }],
    name: getFileNodeName(nodeType, sourcePath),
    type: nodeType,
    url: sourcePath,
    netherstoneSourceKind: "local",
    netherstoneInsertionMethod: "toolbar-upload",
    netherstoneStoredSource: sourcePath,
    netherstoneOriginalPath: sourcePath,
    netherstoneShardPath: currentFilePath ?? undefined,
    netherstoneRenderUrl: renderUrl,
    netherstoneMissing: false,
  };
}

function insertTaggedMediaNodes(
  editor: ReturnType<typeof useEditorRef>,
  nodes: TaggedMediaNode[],
) {
  editor.tf.withoutNormalizing(() => {
    nodes.forEach((node, index) => {
      editor.tf.insertNodes(
        node,
        index === nodes.length - 1 ? { select: true } : undefined,
      );
    });
  });
}

export function MediaToolbarButton({
  nodeType,
  ...props
}: DropdownMenuProps & { nodeType: string }) {
  const currentConfig = MEDIA_CONFIG[nodeType];

  const editor = useEditorRef();
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const mediaInsertionPreference = useSettingsStore(
    (s) => s.mediaInsertionPreference,
  );
  const [open, setOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const pickAndInsertFiles = React.useCallback(async () => {
    if (!currentConfig) return;

    try {
      const selectedPaths = await openMediaFilesDialog(
        currentConfig.dialogKind,
      );

      if (selectedPaths.length === 0) {
        return;
      }

      console.debug("[media-toolbar] Processing native media selection", {
        mediaInsertionPreference,
        nodeType,
        selectedPaths,
        vaultPath: currentVaultPath,
      });

      const nodes = await Promise.all(
        selectedPaths.map((sourcePath) =>
          buildTaggedNativePathNode({
            sourcePath,
            nodeType,
            mediaInsertionPreference,
            currentVaultPath,
            currentFilePath,
          }),
        ),
      );

      insertTaggedMediaNodes(editor, nodes);
      notifyAttachmentSyncStatus(nodes);
    } catch (error) {
      console.error("[media-toolbar] Failed to insert local media files", {
        error,
        nodeType,
        mediaInsertionPreference,
        vaultPath: currentVaultPath,
      });

      toast.error("Failed to insert media from your computer", {
        description:
          error instanceof Error ? error.message : "Unknown insert error.",
      });
    }
  }, [
    currentConfig,
    currentFilePath,
    currentVaultPath,
    editor,
    mediaInsertionPreference,
    nodeType,
  ]);

  if (!currentConfig) {
    return null;
  }

  return (
    <>
      <ToolbarSplitButton
        onClick={() => {
          void pickAndInsertFiles();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        pressed={open}
        tooltip={currentConfig.tooltip}
      >
        <ToolbarSplitButtonPrimary>
          {currentConfig.icon}
        </ToolbarSplitButtonPrimary>

        <DropdownMenu
          open={open}
          onOpenChange={setOpen}
          modal={false}
          {...props}
        >
          <DropdownMenuTrigger asChild>
            <ToolbarSplitButtonSecondary />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            onClick={(e) => e.stopPropagation()}
            align="start"
            alignOffset={-32}
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => {
                  void pickAndInsertFiles();
                }}
              >
                {currentConfig.icon}
                {getUploadActionLabel(mediaInsertionPreference)}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
                <LinkIcon />
                Insert via URL
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ToolbarSplitButton>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(value) => {
          setDialogOpen(value);
        }}
      >
        <AlertDialogContent className="gap-6">
          <MediaUrlDialogContent
            currentConfig={currentConfig}
            nodeType={nodeType}
            setOpen={setDialogOpen}
          />
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MediaUrlDialogContent({
  currentConfig,
  nodeType,
  setOpen,
}: {
  currentConfig: (typeof MEDIA_CONFIG)[string];
  nodeType: string;
  setOpen: (value: boolean) => void;
}) {
  const editor = useEditorRef();
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const [url, setUrl] = React.useState("");

  const embedMedia = React.useCallback(() => {
    if (!isUrl(url)) {
      toast.error("Invalid URL");
      return;
    }

    console.debug("[media-toolbar] Inserting media from URL", {
      nodeType,
      url,
    });

    setOpen(false);

    try {
      editor.tf.insertNodes(
        buildTaggedRemoteNode({ nodeType, url, currentFilePath }),
      );
    } catch (error) {
      console.error("[media-toolbar] Failed to insert media from URL", {
        error,
        nodeType,
        url,
      });
      toast.error("Failed to insert media from URL");
    }
  }, [currentFilePath, editor, nodeType, setOpen, url]);

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{currentConfig.title}</AlertDialogTitle>
      </AlertDialogHeader>

      <AlertDialogDescription className="group relative w-full">
        <label
          className="-translate-y-1/2 absolute top-1/2 block cursor-text px-1 text-muted-foreground/70 text-sm transition-all group-focus-within:pointer-events-none group-focus-within:top-0 group-focus-within:cursor-default group-focus-within:font-medium group-focus-within:text-foreground group-focus-within:text-xs has-[+input:not(:placeholder-shown)]:pointer-events-none has-[+input:not(:placeholder-shown)]:top-0 has-[+input:not(:placeholder-shown)]:cursor-default has-[+input:not(:placeholder-shown)]:font-medium has-[+input:not(:placeholder-shown)]:text-foreground has-[+input:not(:placeholder-shown)]:text-xs"
          htmlFor="url"
        >
          <span className="inline-flex bg-background px-2">URL</span>
        </label>
        <Input
          id="url"
          className="w-full"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              embedMedia();
            }
          }}
          placeholder=""
          type="url"
          autoFocus
        />
      </AlertDialogDescription>

      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={(e) => {
            e.preventDefault();
            embedMedia();
          }}
        >
          Accept
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
