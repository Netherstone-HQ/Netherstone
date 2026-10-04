"use client";

import * as React from "react";

import type { TFileElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { FileUp, Link2Icon } from "lucide-react";
import { PlateElement, useReadOnly, withHOC } from "platejs/react";
import { toast } from "sonner";

import { useVaultStore } from "@/store";
import {
  resolveMediaSource,
  resolveMediaSourceSync,
  type ResolvedMediaSource,
} from "@/lib/media-source";

import { AttachmentBackupIndicator } from "./attachment-backup-indicator";
import { Caption, CaptionTextarea } from "./caption";
import {
  LocalReferenceMediaCard,
  MediaStatusCard,
  MissingLocalMediaCard,
  MissingVaultAttachmentCard,
  VaultAttachmentMediaCard,
} from "./media-status-card";
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
    throw new Error(
      "This file embed does not currently have an openable source.",
    );
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
    throw new Error(
      "This file embed does not currently have a revealable path.",
    );
  }

  if (resolved.kind === "vault" || resolved.kind === "local") {
    await revealItemInDir(target);
    return;
  }

  throw new Error(
    "Only local and vault files can be revealed in the file explorer.",
  );
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

        toast.error("Failed to open file", {
          description:
            error instanceof Error ? error.message : "Unknown open error.",
        });
      }
    }, [resolvedSource, source]);

    const handleReveal = React.useCallback(async () => {
      try {
        await revealResolvedSource(resolvedSource, source);
      } catch (error) {
        console.error("[media-file-node] Failed to reveal file embed", {
          error,
          resolvedSource,
          source,
        });

        toast.error("Failed to reveal file", {
          description:
            error instanceof Error ? error.message : "Unknown reveal error.",
        });
      }
    }, [resolvedSource, source]);

    let content: React.ReactNode;

    if (resolvedSource.kind === "vault" && resolvedSource.isMissing) {
      content = (
        <MissingVaultAttachmentCard
          name={displayName}
          attachmentPath={attachmentPath}
          className="w-full"
          onRelink={
            mediaActions.canRelinkVaultAttachment
              ? () => {
                  void mediaActions.relinkVaultAttachment();
                }
              : undefined
          }
          onRelinkTo={
            mediaActions.canRelinkVaultAttachment
              ? (path) => {
                  void mediaActions.relinkVaultAttachmentTo(path);
                }
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
          disableActions={!mediaActions.canEdit}
        />
      );
    } else if (resolvedSource.kind === "local" && resolvedSource.isMissing) {
      content = (
        <MissingLocalMediaCard
          name={displayName}
          path={attachmentPath}
          className="w-full"
          onLocate={
            mediaActions.canRelinkLocalFile
              ? () => {
                  void mediaActions.relinkLocalFile();
                }
              : undefined
          }
          onImportToVault={
            mediaActions.canImportToVault
              ? () => {
                  void mediaActions.importToVault();
                }
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
          disableActions={!mediaActions.canEdit}
        />
      );
    } else if (resolvedSource.kind === "vault") {
      content = (
        <VaultAttachmentMediaCard
          name={displayName}
          attachmentPath={attachmentPath}
          className="w-full"
          onOpen={handleOpen}
          onReveal={handleReveal}
          onConvertToReference={
            mediaActions.canLinkOriginalFile
              ? () => {
                  void mediaActions.convertToLocalReference();
                }
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
        />
      );
    } else if (resolvedSource.kind === "local") {
      content = (
        <LocalReferenceMediaCard
          name={displayName}
          path={attachmentPath}
          className="w-full"
          onOpen={handleOpen}
          onReveal={handleReveal}
          onImportToVault={
            mediaActions.canImportToVault
              ? () => {
                  void mediaActions.importToVault();
                }
              : undefined
          }
          onRemove={mediaActions.canEdit ? mediaActions.removeNode : undefined}
        />
      );
    } else if (resolvedSource.kind === "remote") {
      content = (
        <MediaStatusCard
          className="w-full"
          tone="default"
          icon={<Link2Icon className="size-4" />}
          title={displayName}
          badge="Remote file"
          description="This file is embedded from a remote URL and will open externally."
          meta={<span className="break-all">{source}</span>}
          actions={[
            {
              label: "Open URL",
              onClick: () => {
                void handleOpen();
              },
            },
          ]}
        />
      );
    } else if (resolvedSource.kind === "blob") {
      content = (
        <MediaStatusCard
          className="w-full"
          tone="warning"
          icon={<FileUp className="size-4" />}
          title={displayName}
          badge="Temporary file URL"
          description="This file uses a temporary in-memory URL. It may work right now, but it may not survive a full app restart."
          meta={<span className="break-all">{source}</span>}
          actions={[
            {
              label: "Open",
              onClick: () => {
                void handleOpen();
              },
            },
          ]}
        />
      );
    } else {
      content = (
        <MediaStatusCard
          className="w-full"
          tone="warning"
          icon={<FileUp className="size-4" />}
          title={displayName}
          badge="File"
          description="This file embed does not currently have a recognized source type."
          meta={
            source ? (
              <span className="break-all">{source}</span>
            ) : (
              "No persisted source was found on this file node."
            )
          }
          actions={
            source
              ? [
                  {
                    label: "Open",
                    onClick: () => {
                      void handleOpen();
                    },
                  },
                ]
              : undefined
          }
        />
      );
    }

    return (
      <PlateElement className="my-px rounded-sm" {...props}>
        <div
          className="relative [&>div:first-of-type]:pr-14"
          contentEditable={false}
        >
          <AttachmentBackupIndicator
            className="absolute top-1/2 right-3 z-10 -translate-y-1/2"
            metadata={props.element}
          />
          {content}
        </div>

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
