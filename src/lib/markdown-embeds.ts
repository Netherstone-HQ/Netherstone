import { KEYS, type TElement } from "platejs";

import { createRawBlockNode, RAW_BLOCK_KEY } from "@/lib/markdown-raw-blocks";

/**
 * An embed (a video or a page shown in the shard) is saved as a link with a
 * hidden comment on the line above, so other Markdown apps show a link to
 * what was embedded:
 *
 *     <!-- netherstone embed: width 480 -->
 *
 *     [Launch talk](https://www.youtube.com/watch?v=abc)
 *
 * The link's text is the caption; without one it is the bare URL. `width` is
 * the width in pixels, once the embed was resized. Older shards saved
 * `<media_embed src="…" />`, which Plate's own rule still reads.
 */

const EMBED_COMMENT = /^<!--\s*netherstone embed(?::\s*([\s\S]*?))?\s*-->$/;

type EmbedElement = TElement & {
  url?: string;
  width?: unknown;
  caption?: { text?: string }[];
};

type LinkElement = TElement & { url?: string };

function isEmbedComment(node: unknown): node is TElement & { value: string } {
  return (
    !!node &&
    typeof node === "object" &&
    (node as TElement).type === RAW_BLOCK_KEY &&
    typeof (node as { value?: unknown }).value === "string" &&
    EMBED_COMMENT.test((node as { value: string }).value.trim())
  );
}

function textOf(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) =>
      typeof node?.text === "string" ? node.text : textOf((node as TElement)?.children),
    )
    .join("");
}

/** The web link a paragraph holds and nothing else, or null. */
function soleWebLink(node: unknown): LinkElement | null {
  if (!node || typeof node !== "object" || (node as TElement).type !== KEYS.p) return null;
  const children = (node as TElement).children.filter(
    (child) => !(typeof child.text === "string" && child.text.trim() === ""),
  );
  const [link] = children as LinkElement[];
  if (children.length !== 1 || link.type !== KEYS.link) return null;
  return typeof link.url === "string" && /^https?:\/\//i.test(link.url) ? link : null;
}

function savedWidth(width: unknown): number | null {
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? Math.round(width)
    : null;
}

/** The comment and link an embed is saved as. */
export function embedBlocks(node: EmbedElement): TElement[] {
  const url = typeof node.url === "string" ? node.url.trim() : "";
  if (!url) return [];
  const width = savedWidth(node.width);
  const caption = textOf(node.caption).trim();
  const { align, indent } = node as { align?: unknown; indent?: unknown };

  return [
    createRawBlockNode(
      width === null ? "<!-- netherstone embed -->" : `<!-- netherstone embed: width ${width} -->`,
    ),
    {
      type: KEYS.p,
      ...(align === undefined ? {} : { align }),
      ...(indent === undefined ? {} : { indent }),
      children: [
        { text: "" },
        { type: KEYS.link, url, children: [{ text: caption || url }] },
        { text: "" },
      ],
    },
  ];
}

function embedFrom(comment: string, paragraph: TElement, link: LinkElement): TElement {
  const settings = EMBED_COMMENT.exec(comment.trim())?.[1] ?? "";
  const width = Number(/(?:^|;)\s*width\s+(\d+)/.exec(settings)?.[1]);
  const caption = textOf(link.children).trim();
  const { align, indent } = paragraph as { align?: unknown; indent?: unknown };

  return {
    type: KEYS.mediaEmbed,
    url: link.url,
    ...(width > 0 ? { width } : {}),
    ...(caption && caption !== link.url ? { caption: [{ text: caption }] } : {}),
    ...(align === undefined ? {} : { align }),
    ...(indent === undefined ? {} : { indent }),
    children: [{ text: "" }],
  };
}

/** Turns each embed comment and the link under it back into an embed. */
export function applyEmbeds<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    const following = value[index + 1];
    const link = isEmbedComment(node) ? soleWebLink(following) : null;

    if (link) {
      next.push(embedFrom((node as { value: string }).value, following, link));
      index += 1;
      changed = true;
      continue;
    }

    if (node && typeof node === "object" && Array.isArray((node as TElement).children)) {
      const children = applyEmbeds((node as TElement).children);
      if (children !== (node as TElement).children) {
        changed = true;
        next.push({ ...(node as TElement), children });
        continue;
      }
    }

    next.push(node);
  }

  return (changed ? next : value) as T;
}
