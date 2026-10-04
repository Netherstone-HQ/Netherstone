"use client";

import * as React from "react";

import type { TImageElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useDraggable } from "@platejs/dnd";
import { ImagePlugin, useMediaState } from "@platejs/media/react";
import { ResizableProvider, useResizableValue } from "@platejs/resizable";
import { PlateElement, withHOC } from "platejs/react";

import { useVaultStore } from "@/store";
import {
  resolveMediaSource,
  resolveMediaSourceSync,
  type ResolvedMediaSource,
} from "@/lib/media-source";
import { cn } from "@/lib/utils";

import { AttachmentBackupIndicator } from "./attachment-backup-indicator";
import { Caption, CaptionTextarea } from "./caption";
import {
  MediaStatusCard,
  MissingLocalMediaCard,
  MissingVaultAttachmentCard,
} from "./media-status-card";
import { useMediaNodeActions } from "./media-node-actions";
import { MediaToolbar } from "./media-toolbar";
import type { WithPersistedMediaMetadata } from "./media-types";
import {
  mediaResizeHandleVariants,
  Resizable,
  ResizeHandle,
} from "./resize-handle";

type PersistedImageElement = WithPersistedMediaMetadata<TImageElement>;

function getImageSource(
  element: PersistedImageElement,
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
  element: PersistedImageElement,
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

export const ImageElement = withHOC(
  ResizableProvider,
  function ImageElement(props: PlateElementProps<PersistedImageElement>) {
    const {
      align = "center",
      focused,
      readOnly,
      selected,
      unsafeUrl,
    } = useMediaState();
    const width = useResizableValue("width");
    const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
    const source = React.useMemo(
      () => getImageSource(props.element, unsafeUrl),
      [props.element, unsafeUrl],
    );

    const [resolvedSource, setResolvedSource] =
      React.useState<ResolvedMediaSource>(() =>
        resolveMediaSourceSync(source, {
          explicitRenderUrl: props.element.netherstoneRenderUrl,
          vaultPath: currentVaultPath,
        }),
      );

    const { isDragging, handleRef } = useDraggable({
      element: props.element,
    });

    const mediaActions = useMediaNodeActions({
      element: props.element,
      mediaKind: "image",
      onAfterChange: (patch) => {
        const nextElement = {
          ...props.element,
          ...patch,
        } as PersistedImageElement;
        const nextRenderUrl =
          typeof nextElement.netherstoneRenderUrl === "string"
            ? nextElement.netherstoneRenderUrl
            : undefined;

        setResolvedSource(
          resolveMediaSourceSync(getImageSource(nextElement, unsafeUrl), {
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

    const renderUrl = resolvedSource.renderUrl || unsafeUrl || "";
    const attachmentPath = getResolvedAttachmentPath(
      resolvedSource,
      props.element,
    );
    const showMissingVaultState =
      resolvedSource.kind === "vault" && resolvedSource.isMissing;
    const showMissingLocalState =
      resolvedSource.kind === "local" && resolvedSource.isMissing;

    if (showMissingVaultState || showMissingLocalState) {
      return (
        <PlateElement {...props} className="py-2.5">
          <figure className="group relative m-0" contentEditable={false}>
            {showMissingVaultState ? (
              <MissingVaultAttachmentCard
                name={(props.attributes.alt as string | undefined) ?? undefined}
                attachmentPath={attachmentPath}
                className="w-full"
                onRelink={() => {
                  void mediaActions.relinkVaultAttachment();
                }}
                onRelinkTo={(path) => {
                  void mediaActions.relinkVaultAttachmentTo(path);
                }}
                onRemove={mediaActions.removeNode}
                disableActions={!mediaActions.canRelinkVaultAttachment}
              />
            ) : (
              <MissingLocalMediaCard
                name={(props.attributes.alt as string | undefined) ?? undefined}
                path={attachmentPath}
                className="w-full"
                onLocate={() => {
                  void mediaActions.relinkLocalFile();
                }}
                onImportToVault={() => {
                  void mediaActions.importToVault();
                }}
                onRemove={mediaActions.removeNode}
                disableActions={!mediaActions.canRelinkLocalFile}
              />
            )}

            <Caption style={{ width }} align={align}>
              <CaptionTextarea
                readOnly={readOnly}
                onFocus={(e) => {
                  e.preventDefault();
                }}
                placeholder="Write a caption..."
              />
            </Caption>
          </figure>

          {props.children}
        </PlateElement>
      );
    }

    if (!renderUrl) {
      return (
        <PlateElement {...props} className="py-2.5">
          <MediaStatusCard
            className="w-full"
            tone="warning"
            title="Image source unavailable"
            badge="Image"
            description="This image does not currently have a usable source."
            meta={
              source ? (
                <span className="break-all">{source}</span>
              ) : (
                "No persisted source was found on this image node."
              )
            }
          />

          {props.children}
        </PlateElement>
      );
    }

    return (
      <MediaToolbar plugin={ImagePlugin}>
        <PlateElement {...props} className="py-2.5">
          <figure className="group relative m-0" contentEditable={false}>
            <AttachmentBackupIndicator
              className="absolute top-1/2 right-3 z-10 -translate-y-1/2 opacity-90 transition-opacity group-hover:opacity-100"
              metadata={props.element}
            />

            <Resizable
              align={align}
              options={{
                align,
                readOnly,
              }}
            >
              <ResizeHandle
                className={mediaResizeHandleVariants({ direction: "left" })}
                options={{ direction: "left" }}
              />
              <img
                ref={handleRef as React.Ref<HTMLImageElement>}
                className={cn(
                  "block w-full max-w-full cursor-pointer object-cover px-0",
                  "rounded-sm",
                  focused && selected && "ring-2 ring-ring ring-offset-2",
                  isDragging && "opacity-50",
                )}
                src={renderUrl}
                alt={props.attributes.alt as string | undefined}
              />
              <ResizeHandle
                className={mediaResizeHandleVariants({
                  direction: "right",
                })}
                options={{ direction: "right" }}
              />
            </Resizable>

            <Caption style={{ width }} align={align}>
              <CaptionTextarea
                readOnly={readOnly}
                onFocus={(e) => {
                  e.preventDefault();
                }}
                placeholder="Write a caption..."
              />
            </Caption>
          </figure>

          {props.children}
        </PlateElement>
      </MediaToolbar>
    );
  },
);
