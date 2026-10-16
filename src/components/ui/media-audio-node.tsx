"use client";

import * as React from "react";

import type { TAudioElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useMediaState } from "@platejs/media/react";
import { ResizableProvider } from "@platejs/resizable";
import { PlateElement, withHOC } from "platejs/react";

import { useVaultStore } from "@/store";
import {
  resolveMediaSource,
  resolveMediaSourceSync,
  type ResolvedMediaSource,
} from "@/lib/media-source";

import { Caption, CaptionTextarea } from "./caption";
import {
  MediaFileRow,
  MissingLinkedFileRow,
  MissingVaultFileRow,
  UnsyncedTag,
} from "./media-file-row";
import { useMediaNodeActions } from "./media-node-actions";
import type { WithPersistedMediaMetadata } from "./media-types";

type PersistedAudioElement = WithPersistedMediaMetadata<TAudioElement>;

function getAudioSource(
  element: PersistedAudioElement,
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
  element: PersistedAudioElement,
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

export const AudioElement = withHOC(
  ResizableProvider,
  function AudioElement(props: PlateElementProps<PersistedAudioElement>) {
    const { align = "center", readOnly, unsafeUrl } = useMediaState();
    const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
    const source = React.useMemo(
      () => getAudioSource(props.element, unsafeUrl),
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
      mediaKind: "audio",
      onAfterChange: (patch) => {
        const nextElement = {
          ...props.element,
          ...patch,
        } as PersistedAudioElement;
        const nextRenderUrl =
          typeof nextElement.netherstoneRenderUrl === "string"
            ? nextElement.netherstoneRenderUrl
            : undefined;

        setResolvedSource(
          resolveMediaSourceSync(getAudioSource(nextElement, unsafeUrl), {
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
    const displayName =
      props.element.name?.trim() || props.attributes["data-name"]?.toString();

    const showMissingVaultState =
      resolvedSource.kind === "vault" && resolvedSource.isMissing;
    const showMissingLocalState =
      resolvedSource.kind === "local" && resolvedSource.isMissing;

    if (showMissingVaultState || showMissingLocalState) {
      return (
        <PlateElement {...props} className="mb-1">
          <figure
            className="group relative cursor-default"
            contentEditable={false}
          >
            {showMissingVaultState ? (
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
                onRemove={
                  mediaActions.canEdit ? mediaActions.removeNode : undefined
                }
              />
            ) : (
              <MissingLinkedFileRow
                name={displayName}
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

            <Caption style={{ width: "100%" }} align={align}>
              <CaptionTextarea
                className="h-20"
                readOnly={readOnly}
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
        <PlateElement {...props} className="mb-1">
          <MediaFileRow warning name="Audio" details="No source found" />
          {props.children}
        </PlateElement>
      );
    }

    return (
      <PlateElement {...props} className="mb-1">
        <figure
          className="group relative cursor-default"
          contentEditable={false}
        >
          <div className="h-16">
            <audio className="size-full" src={renderUrl} controls />
          </div>

          <UnsyncedTag className="mt-1.5" metadata={props.element} />

          <Caption style={{ width: "100%" }} align={align}>
            <CaptionTextarea
              className="h-20"
              readOnly={readOnly}
              placeholder="Write a caption..."
            />
          </Caption>
        </figure>
        {props.children}
      </PlateElement>
    );
  },
);
