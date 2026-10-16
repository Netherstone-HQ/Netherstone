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

import { Caption, CaptionTextarea } from "./caption";
import {
  MediaFileRow,
  MissingLinkedFileRow,
  MissingVaultFileRow,
  UnsyncedTag,
} from "./media-file-row";
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
              <MissingVaultFileRow
                name={(props.attributes.alt as string | undefined) ?? undefined}
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
                onRemove={
                  mediaActions.canEdit ? mediaActions.removeNode : undefined
                }
              />
            ) : (
              <MissingLinkedFileRow
                name={(props.attributes.alt as string | undefined) ?? undefined}
                path={attachmentPath}
                onLocate={
                  mediaActions.canRelinkLocalFile
                    ? () => void mediaActions.relinkLocalFile()
                    : undefined
                }
                onRemove={
                  mediaActions.canEdit ? mediaActions.removeNode : undefined
                }
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
          <MediaFileRow warning name="Image" details="No source found" />

          {props.children}
        </PlateElement>
      );
    }

    return (
      <MediaToolbar plugin={ImagePlugin}>
        <PlateElement {...props} className="py-2.5">
          <figure className="group relative m-0" contentEditable={false}>
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

            <UnsyncedTag className="mt-1.5" metadata={props.element} />

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
