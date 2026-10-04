"use client";

import * as React from "react";
import LiteYouTubeEmbed from "react-lite-youtube-embed";
import ReactPlayer from "react-player";

import type { TResizableProps, TVideoElement } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useDraggable } from "@platejs/dnd";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";
import { useMediaState } from "@platejs/media/react";
import { ResizableProvider, useResizableValue } from "@platejs/resizable";
import { PlateElement, useEditorMounted, withHOC } from "platejs/react";

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
import type { WithPersistedMediaMetadata } from "./media-types";
import {
  mediaResizeHandleVariants,
  Resizable,
  ResizeHandle,
} from "./resize-handle";

type PersistedVideoElement = WithPersistedMediaMetadata<TVideoElement> &
  TResizableProps;

function getVideoSource(
  element: PersistedVideoElement,
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
  element: PersistedVideoElement,
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

export const VideoElement = withHOC(
  ResizableProvider,
  function VideoElement(
    props: PlateElementProps<PersistedVideoElement & TResizableProps>,
  ) {
    const {
      align = "center",
      embed,
      isVideo,
      isUpload,
      isYoutube,
      readOnly,
      unsafeUrl,
    } = useMediaState({
      urlParsers: [parseTwitterUrl, parseVideoUrl],
    });

    const width = useResizableValue("width");
    const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
    const source = React.useMemo(
      () => getVideoSource(props.element, unsafeUrl),
      [props.element, unsafeUrl],
    );

    const [resolvedSource, setResolvedSource] =
      React.useState<ResolvedMediaSource>(() =>
        resolveMediaSourceSync(source, {
          explicitRenderUrl: props.element.netherstoneRenderUrl,
          vaultPath: currentVaultPath,
        }),
      );

    const isEditorMounted = useEditorMounted();
    const mediaActions = useMediaNodeActions({
      element: props.element,
      mediaKind: "video",
      onAfterChange: (patch) => {
        const nextElement = {
          ...props.element,
          ...patch,
        } as PersistedVideoElement;
        const nextRenderUrl =
          typeof nextElement.netherstoneRenderUrl === "string"
            ? nextElement.netherstoneRenderUrl
            : undefined;

        setResolvedSource(
          resolveMediaSourceSync(getVideoSource(nextElement, unsafeUrl), {
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

    const { isDragging, handleRef } = useDraggable({
      element: props.element,
    });

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
        <PlateElement className="py-2.5" {...props}>
          <figure
            className="relative m-0 cursor-default"
            contentEditable={false}
          >
            {showMissingVaultState ? (
              <MissingVaultAttachmentCard
                name={props.element.name}
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
                name={props.element.name}
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
        <PlateElement className="py-2.5" {...props}>
          <MediaStatusCard
            className="w-full"
            tone="warning"
            title="Video source unavailable"
            badge="Video"
            description="This video embed does not currently have a usable source."
            meta={
              source ? (
                <span className="break-all">{source}</span>
              ) : (
                "No persisted source was found on this video node."
              )
            }
          />
          {props.children}
        </PlateElement>
      );
    }

    const isLocalOrVaultBacked =
      resolvedSource.kind === "vault" ||
      resolvedSource.kind === "local" ||
      resolvedSource.kind === "blob" ||
      resolvedSource.kind === "data";

    const shouldRenderYoutubeEmbed =
      isEditorMounted &&
      resolvedSource.kind === "remote" &&
      !isUpload &&
      isYoutube &&
      !!embed?.id;

    const shouldRenderNativeVideo =
      isEditorMounted &&
      (isLocalOrVaultBacked ||
        resolvedSource.kind === "blob" ||
        resolvedSource.kind === "data" ||
        (resolvedSource.kind === "remote" && (isUpload || !isVideo)));

    const shouldRenderRemotePlayer =
      isEditorMounted &&
      resolvedSource.kind === "remote" &&
      !isUpload &&
      !isYoutube &&
      isVideo;

    const isTweet = true;

    return (
      <PlateElement className="py-2.5" {...props}>
        <figure
          className="group relative m-0 cursor-default"
          contentEditable={false}
        >
          <AttachmentBackupIndicator
            className="absolute top-1/2 right-3 z-10 -translate-y-1/2 opacity-90 transition-opacity group-hover:opacity-100"
            metadata={props.element}
          />

          <Resizable
            className={cn(isDragging && "opacity-50")}
            align={align}
            options={{
              align,
              maxWidth: isTweet ? 550 : "100%",
              minWidth: isTweet ? 300 : 100,
              readOnly,
            }}
          >
            <div className="group/media">
              <ResizeHandle
                className={mediaResizeHandleVariants({ direction: "left" })}
                options={{ direction: "left" }}
              />

              <ResizeHandle
                className={mediaResizeHandleVariants({ direction: "right" })}
                options={{ direction: "right" }}
              />

              {shouldRenderYoutubeEmbed && (
                <div ref={handleRef}>
                  <LiteYouTubeEmbed
                    id={embed!.id!}
                    title="youtube"
                    wrapperClass={cn(
                      "aspect-video rounded-sm",
                      "relative block cursor-pointer bg-black bg-center bg-cover [contain:content]",
                      "[&.lyt-activated]:before:absolute [&.lyt-activated]:before:top-0 [&.lyt-activated]:before:h-[60px] [&.lyt-activated]:before:w-full [&.lyt-activated]:before:bg-top [&.lyt-activated]:before:bg-repeat-x [&.lyt-activated]:before:pb-[50px] [&.lyt-activated]:before:[transition:all_0.2s_cubic-bezier(0,_0,_0.2,_1)]",
                      "[&.lyt-activated]:before:bg-[url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAADGCAYAAAAT+OqFAAAAdklEQVQoz42QQQ7AIAgEF/T/D+kbq/RWAlnQyyazA4aoAB4FsBSA/bFjuF1EOL7VbrIrBuusmrt4ZZORfb6ehbWdnRHEIiITaEUKa5EJqUakRSaEYBJSCY2dEstQY7AuxahwXFrvZmWl2rh4JZ07z9dLtesfNj5q0FU3A5ObbwAAAABJRU5ErkJggg==)]",
                      'after:block after:pb-[var(--aspect-ratio)] after:content-[""]',
                      "[&_>_iframe]:absolute [&_>_iframe]:top-0 [&_>_iframe]:left-0 [&_>_iframe]:size-full",
                      "[&_>_.lty-playbtn]:z-1 [&_>_.lty-playbtn]:h-[46px] [&_>_.lty-playbtn]:w-[70px] [&_>_.lty-playbtn]:rounded-[14%] [&_>_.lty-playbtn]:bg-[#212121] [&_>_.lty-playbtn]:opacity-80 [&_>_.lty-playbtn]:[transition:all_0.2s_cubic-bezier(0,_0,_0.2,_1)]",
                      "[&:hover_>_.lty-playbtn]:bg-[red] [&:hover_>_.lty-playbtn]:opacity-100",
                      '[&_>_.lty-playbtn]:before:border-[transparent_transparent_transparent_#fff] [&_>_.lty-playbtn]:before:border-y-[11px] [&_>_.lty-playbtn]:before:border-r-0 [&_>_.lty-playbtn]:before:border-l-[19px] [&_>_.lty-playbtn]:before:content-[""]',
                      "[&_>_.lty-playbtn]:absolute [&_>_.lty-playbtn]:top-1/2 [&_>_.lty-playbtn]:left-1/2 [&_>_.lty-playbtn]:[transform:translate3d(-50%,-50%,0)]",
                      "[&_>_.lty-playbtn]:before:absolute [&_>_.lty-playbtn]:before:top-1/2 [&_>_.lty-playbtn]:before:left-1/2 [&_>_.lty-playbtn]:before:[transform:translate3d(-50%,-50%,0)]",
                      "[&.lyt-activated]:cursor-[unset]",
                      "[&.lyt-activated]:before:pointer-events-none [&.lyt-activated]:before:opacity-0",
                      "[&.lyt-activated_>_.lty-playbtn]:pointer-events-none [&.lyt-activated_>_.lty-playbtn]:opacity-0!",
                    )}
                  />
                </div>
              )}

              {shouldRenderNativeVideo && (
                <div ref={handleRef}>
                  <video
                    className="w-full max-w-full rounded-sm object-cover px-0"
                    src={renderUrl}
                    controls
                  />
                </div>
              )}

              {shouldRenderRemotePlayer && (
                <div ref={handleRef}>
                  <ReactPlayer
                    height="100%"
                    src={renderUrl}
                    width="100%"
                    controls
                  />
                </div>
              )}
            </div>
          </Resizable>

          <Caption style={{ width }} align={align}>
            <CaptionTextarea
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
