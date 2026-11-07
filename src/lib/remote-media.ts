import { KEYS } from "platejs";

/** Blocks that load what their address points at as soon as they show. */
const MEDIA_TYPES = new Set<string>([
  KEYS.img,
  KEYS.video,
  KEYS.audio,
  KEYS.file,
  KEYS.mediaEmbed,
]);

const NAMES: Record<string, string> = {
  [KEYS.img]: "Image",
  [KEYS.video]: "Video",
  [KEYS.audio]: "Sound",
  [KEYS.file]: "File",
  [KEYS.mediaEmbed]: "Embed",
};

/** An address on another computer, with or without its scheme. */
export function isRemoteAddress(address: unknown): address is string {
  return typeof address === "string" && /^\s*(https?:)?\/\//i.test(address);
}

/** The remote addresses a media block would load. */
function remoteAddresses(node: Record<string, unknown>): string[] {
  return Object.values(node).filter(isRemoteAddress);
}

function isMedia(node: any): node is Record<string, unknown> {
  return !!node && typeof node === "object" && MEDIA_TYPES.has(node.type);
}

/** Every remote address the media blocks in `nodes` load. */
export function remoteMediaIn(nodes: readonly any[]): Set<string> {
  const found = new Set<string>();
  const walk = (list: readonly any[]) => {
    for (const node of list) {
      if (isMedia(node)) remoteAddresses(node).forEach((a) => found.add(a));
      if (Array.isArray(node?.children)) walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

/**
 * `nodes` with each media block that loads a remote address not in `known`
 * shown as a line naming it, with a link to the address instead. A preview
 * then loads nothing new from the web before the user acts on it.
 */
export function withRemoteMediaAsLinks<T>(
  nodes: readonly T[],
  known: ReadonlySet<string> = new Set(),
): T[] {
  return nodes.map((node: any) => {
    if (isMedia(node)) {
      const address = remoteAddresses(node).find((a) => !known.has(a));
      if (address === undefined) return node;
      return {
        type: KEYS.p,
        children: [
          { text: `${NAMES[node.type as string]}: ` },
          { type: KEYS.link, url: address, children: [{ text: address }] },
          { text: "" },
        ],
      } as T;
    }
    if (Array.isArray(node?.children)) {
      return { ...node, children: withRemoteMediaAsLinks(node.children, known) };
    }
    return node;
  });
}
