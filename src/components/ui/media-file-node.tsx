"use client";

import * as React from "react";

import type { TFileElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { LinkIcon } from "lucide-react";
import { PlateElement, useReadOnly, withHOC } from "platejs/react";
import { toast } from "sonner";

import { useVaultStore } from "@/store";
import {
  resolveMediaSource,
  resolveMediaSourceSync,
  type ResolvedMediaSource,
} from "@/lib/media-source";

import { Hint } from "@/components/ui/tooltip";

import { Caption, CaptionTextarea } from "./caption";
import {
  LinkedFileDetails,
  MediaFileRow,
  MissingLinkedFileRow,
  MissingVaultFileRow,
  VaultFileDetails,
  useVaultRelativePath,
} from "./media-file-row";
import { useMediaNodeActions } from "./media-node-actions";
import type { WithPersistedMediaMetadata } from "./media-types";

type PersistedFileElement = WithPersistedMediaMetadata<TFileElement>;

function getFileSource(
  element: PersistedFileElement,
  unsafeUrl?: string | null,
): string {
  if (
    typeof element.netherstoneStoredSource === "string" &&
    element.netherstoneStoredSource.trim().length > 0
  ) {
    return element.netherstoneStoredSource.trim();
  }

  if (typeof element.url === "string" && element.url.trim().length > 0) {
    return element.url.trim();
  }

  if (typeof unsafeUrl === "string" && unsafeUrl.trim().length > 0) {
    return unsafeUrl.trim();
  }

  return "";
}

function getResolvedAttachmentPath(
  resolved: ResolvedMediaSource,
  element: PersistedFileElement,
): string | null {
  if (resolved.path) return resolved.path;

  if (
    typeof element.netherstoneImportedPath === "string" &&
    element.netherstoneImportedPath.trim().length > 0
  ) {
    return element.netherstoneImportedPath.trim();
  }

  if (
    typeof element.netherstoneOriginalPath === "string" &&
    element.netherstoneOriginalPath.trim().length > 0
  ) {
    return element.netherstoneOriginalPath.trim();
  }

  return null;
}

async function openResolvedSource(
  resolved: ResolvedMediaSource,
  fallbackSource: string,
): Promise<void> {
  const target =
    resolved.openTarget ||
    resolved.path ||
    resolved.renderUrl ||
    fallbackSource;

  if (!target) {
    throw new Error("This file has no location to open.");
  }

  if (resolved.kind === "remote") {
    await openUrl(target);
    return;
  }

  if (resolved.kind === "vault" || resolved.kind === "local") {
    await openPath(target);
    return;
  }

  if (
    resolved.kind === "blob" ||
    resolved.kind === "data" ||
    resolved.kind === "unknown"
  ) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }

  await openPath(target);
}

async function revealResolvedSource(
  resolved: ResolvedMediaSource,
  fallbackSource: string,
): Promise<void> {
  const target = resolved.path || resolved.openTarget || fallbackSource;

  if (!target) {
    throw new Error("This file has no location to show.");
  }

  if (resolved.kind === "vault" || resolved.kind === "local") {
    await revealItemInDir(target);
    return;
  }

  throw new Error("Only files on this computer can be shown in a folder.");
}

export const FileElement = withHOC(
  ResizableProvider,
  function FileElement(props: PlateElementProps<PersistedFileElement>) {
    const readOnly = useReadOnly();
    const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
    const { name, unsafeUrl } = useMediaState();

    const source = React.useMemo(
      () => getFileSource(props.element, unsafeUrl),
      [props.element, unsafeUrl],
    );

    const [resolvedSource, setResolvedSource] =
      React.useState<ResolvedMediaSource>(() =>
        resolveMediaSourceSync(source, {
          explicitRenderUrl: props.element.netherstoneRenderUrl,
          vaultPath: currentVaultPath,
        }),
      );

    const mediaActions = useMediaNodeActions({
      element: props.element,
      mediaKind: "file",
      onAfterChange: (patch) => {
        const nextElement = {
          ...props.element,
          ...patch,
        } as PersistedFileElement;
        const nextRenderUrl =
          typeof nextElement.netherstoneRenderUrl === "string"
            ? nextElement.netherstoneRenderUrl
            : undefined;

        setResolvedSource(
          resolveMediaSourceSync(getFileSource(nextElement, unsafeUrl), {
            explicitRenderUrl: nextRenderUrl,
            vaultPath: currentVaultPath,
          }),
        );
      },
    });

    React.useEffect(() => {
      let cancelled = false;

      const syncResolved = resolveMediaSourceSync(source, {
        explicitRenderUrl: props.element.netherstoneRenderUrl,
        vaultPath: currentVaultPath,
      });
      setResolvedSource(syncResolved);

      void resolveMediaSource(source, {
        explicitRenderUrl: props.element.netherstoneRenderUrl,
        vaultPath: currentVaultPath,
        checkExistence:
          syncResolved.kind === "vault" || syncResolved.kind === "local",
      }).then((nextResolved) => {
        if (cancelled) return;
        setResolvedSource(nextResolved);
      });

      return () => {
        cancelled = true;
      };
    }, [currentVaultPath, props.element.netherstoneRenderUrl, source]);

    const displayName =
      name?.trim() ||
      props.element.name?.trim() ||
      (typeof source === "string" ? source.split("/").pop() : "") ||
      "Embedded file";

    const attachmentPath = getResolvedAttachmentPath(
      resolvedSource,
      props.element,
    );

    const handleOpen = React.useCallback(async () => {
      try {
        await openResolvedSource(resolvedSource, source);
      } catch (error) {
        console.error("[media-file-node] Failed to open file embed", {
          error,
          resolvedSource,
          source,
        });

        toast.error(`Couldn't open ${displayName}`, {
          description:
            error instanceof Error ? error.message : undefined,
        });
      }
    }, [displayName, resolvedSource, source]);

    const handleReveal = React.useCallback(async () => {
      try {
        await revealResolvedSource(resolvedSource, source);
      } catch (error) {
        console.error("[media-file-node] Failed to reveal file embed", {
          error,
          resolvedSource,
          source,
        });

        toast.error(`Couldn't show ${displayName}`, {
          description:
            error instanceof Error ? error.message : undefined,
        });
      }
    }, [displayName, resolvedSource, source]);

    const shownPath = useVaultRelativePath(attachmentPath);
    const remove = mediaActions.canEdit
      ? [
          {
            label: "Remove",
            onSelect: mediaActions.removeNode,
            destructive: true,
          },
        ]
      : [];

    let content: React.ReactNode;

    if (resolvedSource.kind === "vault" && resolvedSource.isMissing) {
      content = (
        <MissingVaultFileRow
          name={displayName}
          attachmentPath={attachmentPath}
          onRelink={
            mediaActions.canRelinkVaultAttachment
              ? () => void mediaActions.relinkVaultAttachment()
              : undefined
          }
          onRelinkTo={
            mediaActions.canRelinkVaultAttachment
              ? (path) => void mediaActions.relinkVaultAttachmentTo(path)
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
        />
      );
    } else if (resolvedSource.kind === "local" && resolvedSource.isMissing) {
      content = (
        <MissingLinkedFileRow
          name={displayName}
          path={attachmentPath}
          onLocate={
            mediaActions.canRelinkLocalFile
              ? () => void mediaActions.relinkLocalFile()
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
        />
      );
    } else if (resolvedSource.kind === "vault") {
      content = (
        <MediaFileRow
          name={displayName}
          nameHint={shownPath}
          details={<VaultFileDetails metadata={props.element} />}
          onOpen={() => void handleOpen()}
          action={{ label: "Open", onSelect: () => void handleOpen() }}
          onReveal={() => void handleReveal()}
          menu={[
            ...(mediaActions.canLinkOriginalFile
              ? [
                  {
                    label: "Link original file",
                    onSelect: () => void mediaActions.convertToLocalReference(),
                  },
                ]
              : []),
            ...remove,
          ]}
        />
      );
    } else if (resolvedSource.kind === "local") {
      content = (
        <MediaFileRow
          name={displayName}
          nameHint={attachmentPath}
          details={<LinkedFileDetails metadata={props.element} />}
          onOpen={() => void handleOpen()}
          action={{ label: "Open", onSelect: () => void handleOpen() }}
          onReveal={() => void handleReveal()}
          menu={[
            ...(mediaActions.canImportToVault
              ? [
                  {
                    label: "Copy into vault",
                    onSelect: () => void mediaActions.importToVault(),
                  },
                ]
              : []),
            ...remove,
          ]}
        />
      );
    } else if (resolvedSource.kind === "remote") {
      content = (
        <MediaFileRow
          icon={LinkIcon}
          name={displayName}
          nameHint={source}
          details={getHost(source)}
          onOpen={() => void handleOpen()}
          action={{ label: "Open", onSelect: () => void handleOpen() }}
          menu={remove}
        />
      );
    } else {
      // A temporary in-memory file, or a source Netherstone doesn't know.
      const temporary = resolvedSource.kind === "blob";
      content = (
        <MediaFileRow
          warning
          name={displayName}
          details={
            <Hint
              label={
                temporary
                  ? "It may be gone after Netherstone restarts."
                  : "Netherstone can't tell where this file is."
              }
            >
              <span>{temporary ? "Temporary file" : "Unknown source"}</span>
            </Hint>
          }
          action={
            source
              ? { label: "Open", onSelect: () => void handleOpen() }
              : undefined
          }
          menu={remove}
        />
      );
    }

    return (
      <PlateElement className="my-px rounded-sm" {...props}>
        <div contentEditable={false}>{content}</div>

        <Caption align="left">
          <CaptionTextarea
            className="text-left"
            readOnly={readOnly}
            placeholder="Write a caption..."
          />
        </Caption>

        {props.children}
      </PlateElement>
    );
  },
);

/** The site a remote file is on, as "example.com". */
function getHost(source: string) {
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}
