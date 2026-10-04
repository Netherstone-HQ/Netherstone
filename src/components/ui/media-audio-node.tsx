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

import { AttachmentBackupIndicator } from "./attachment-backup-indicator";
import { Caption, CaptionTextarea } from "./caption";
import {
  MediaStatusCard,
  MissingLocalMediaCard,
  MissingVaultAttachmentCard,
} from "./media-status-card";
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
              <MissingVaultAttachmentCard
                name={displayName}
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
                name={displayName}
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
          <MediaStatusCard
            className="w-full"
            tone="warning"
            title="Audio source unavailable"
            badge="Audio"
            description="This audio embed does not currently have a usable source."
            meta={
              source ? (
                <span className="break-all">{source}</span>
              ) : (
                "No persisted source was found on this audio node."
              )
            }
          />
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
          <AttachmentBackupIndicator
            className="absolute top-1/2 right-3 z-10 -translate-y-1/2 opacity-90 transition-opacity group-hover:opacity-100"
            metadata={props.element}
          />

          <div className="h-16 pr-14">
            <audio className="size-full" src={renderUrl} controls />
          </div>

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
