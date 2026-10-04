"use client";

import * as React from "react";

import {
  AudioLinesIcon,
  FileUpIcon,
  FilmIcon,
  ImageIcon,
  LinkIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import {
  PlateElement,
  type PlateElementProps,
  useReadOnly,
  useRemoveNodeButton,
} from "platejs/react";

import { Button } from "@/components/ui/button";

type MediaPlaceholderElement = {
  children: { text: string }[];
  id?: string;
  mediaType?: string;
  name?: string;
  type: string;
  url?: string;
};

function getPlaceholderConfig(mediaType?: string) {
  switch (mediaType) {
    case KEYS.img:
      return {
        icon: ImageIcon,
        label: "Image",
      };
    case KEYS.video:
      return {
        icon: FilmIcon,
        label: "Video",
      };
    case KEYS.audio:
      return {
        icon: AudioLinesIcon,
        label: "Audio",
      };
    case KEYS.file:
      return {
        icon: FileUpIcon,
        label: "File",
      };
    default:
      return {
        icon: TriangleAlertIcon,
        label: "Media",
      };
  }
}

export function MediaPlaceholderNode(
  props: PlateElementProps<MediaPlaceholderElement>,
) {
  const readOnly = useReadOnly();
  const element = props.element;
  const mediaType = element.mediaType ?? element.type;
  const { icon: Icon, label } = getPlaceholderConfig(mediaType);
  const { props: removeButtonProps } = useRemoveNodeButton({ element });

  const displayName =
    element.name?.trim() ||
    (typeof element.url === "string" ? element.url.split("/").pop() : "") ||
    `${label} placeholder`;

  return (
    <PlateElement {...props} className="py-2.5">
      <div
        className="rounded-lg border border-dashed border-border bg-muted/40 p-3"
        contentEditable={false}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-background p-2 text-muted-foreground">
            <Icon className="size-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{label} placeholder</span>
              {element.id ? (
                <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {element.id}
                </span>
              ) : null}
            </div>

            <div className="mt-1 wrap-break-word text-sm text-muted-foreground">
              {displayName}
            </div>

            {element.url ? (
              <div className="mt-1 break-all text-xs text-muted-foreground/80">
                {element.url}
              </div>
            ) : null}

            {!readOnly ? (
              <p className="mt-2 text-xs text-muted-foreground">
                This media item was inserted as a placeholder. If automatic
                upload or replacement is not configured, it will stay in this
                state until you replace it or remove it.
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {element.url ? (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={element.url}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    <LinkIcon className="size-4" />
                    Open source
                  </a>
                </Button>
              ) : null}

              {!readOnly ? (
                <Button size="sm" variant="ghost" {...removeButtonProps}>
                  <Trash2Icon className="size-4" />
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {props.children}
    </PlateElement>
  );
}

export const PlaceholderElement = MediaPlaceholderNode;
