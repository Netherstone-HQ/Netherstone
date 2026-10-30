"use client";

import * as React from "react";
import LiteYouTubeEmbed from "react-lite-youtube-embed";

import type { TMediaEmbedElement, TResizableProps } from "platejs";
import type { PlateElementProps } from "platejs/react";

import { useDraggable } from "@platejs/dnd";
import { parseTwitterUrl, parseVideoUrl } from "@platejs/media";
import { useMediaState } from "@platejs/media/react";
import { ResizableProvider, useResizableValue } from "@platejs/resizable";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LinkIcon } from "lucide-react";
import { PlateElement, useEditorMounted, withHOC } from "platejs/react";

import { cn } from "@/lib/utils";

import { Caption, CaptionTextarea } from "./caption";
import { MediaFileRow } from "./media-file-row";
import { youtubeEmbedClassName } from "./media-video-node";
import {
  mediaResizeHandleVariants,
  Resizable,
  ResizeHandle,
} from "./resize-handle";

function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A video or page shown in the shard. Sites with an embeddable player
 * (YouTube, Vimeo and the others Plate knows) play here; anything else shows
 * as a link that opens in the browser.
 */
export const MediaEmbedElement = withHOC(
  ResizableProvider,
  function MediaEmbedElement(
    props: PlateElementProps<TMediaEmbedElement & TResizableProps>,
  ) {
    const { align = "center", embed, isVideo, isYoutube, readOnly, unsafeUrl } =
      useMediaState({ urlParsers: [parseTwitterUrl, parseVideoUrl] });
    const width = useResizableValue("width");
    const isEditorMounted = useEditorMounted();
    const { isDragging, handleRef } = useDraggable({ element: props.element });
    const url = unsafeUrl ?? "";
    const playerUrl = isVideo ? embed?.url : undefined;

    if (!isEditorMounted || !playerUrl) {
      return (
        <PlateElement className="py-2.5" {...props}>
          <div contentEditable={false}>
            <MediaFileRow
              icon={LinkIcon}
              name={siteOf(url) || "Embed"}
              details={url || "No address"}
              warning={!url}
              onOpen={url ? () => void openUrl(url) : undefined}
            />
          </div>
          {props.children}
        </PlateElement>
      );
    }

    return (
      <PlateElement className="py-2.5" {...props}>
        <figure
          className="group relative m-0 w-full cursor-default"
          contentEditable={false}
        >
          <Resizable
            className={cn(isDragging && "opacity-50")}
            align={align}
            options={{ align, maxWidth: "100%", minWidth: 100, readOnly }}
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
              <div ref={handleRef}>
                {isYoutube && embed?.id ? (
                  <LiteYouTubeEmbed
                    id={embed.id}
                    title="youtube"
                    wrapperClass={youtubeEmbedClassName}
                  />
                ) : (
                  <iframe
                    className="aspect-video w-full rounded-sm"
                    src={playerUrl}
                    title={siteOf(url)}
                    allowFullScreen
                  />
                )}
              </div>
            </div>
          </Resizable>

          <Caption style={{ width }} align={align}>
            <CaptionTextarea readOnly={readOnly} placeholder="Write a caption..." />
          </Caption>
        </figure>
        {props.children}
      </PlateElement>
    );
  },
);
