import { useMemo } from "react";

import { type EmbedUrlParser, parseMediaUrl, VIDEO_PROVIDERS } from "@platejs/media";
import { KEYS, type TMediaElement, type TResizableProps } from "platejs";
import { useEditorRef, useElement, useFocused, useReadOnly } from "platejs/react";

import { useElementSelected } from "./use-element-selected";

/**
 * Plate's `useMediaState`, with the selected check done once per change
 * (see `useElementSelected`) instead of once per picture, video or file.
 */
export function useMediaState({ urlParsers }: { urlParsers?: EmbedUrlParser[] } = {}) {
  const editor = useEditorRef();
  const element = useElement<TMediaElement & TResizableProps>();
  const focused = useFocused();
  const selected = useElementSelected();
  const readOnly = useReadOnly();
  const { id, align, isUpload, name, type, url } = element;
  const embed = useMemo(() => {
    if (!urlParsers || (type !== editor.getType(KEYS.video) && type !== editor.getType(KEYS.mediaEmbed))) {
      return undefined;
    }
    return parseMediaUrl(url, { urlParsers });
  }, [editor, urlParsers, type, url]);
  return {
    id,
    align,
    embed,
    focused,
    isTweet: embed?.provider === "twitter",
    isUpload,
    isVideo: !!embed?.provider && VIDEO_PROVIDERS.includes(embed.provider),
    isYoutube: embed?.provider === "youtube",
    name,
    readOnly,
    selected,
    unsafeUrl: url,
  };
}
