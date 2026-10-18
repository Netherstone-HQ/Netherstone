import { defaultRules, type MdRules } from "@platejs/markdown";
import { createSlatePlugin, getPluginType, KEYS, type SlateEditor } from "platejs";

/**
 * @ links between shards.
 *
 * In the editor an @ link is a mention element: `value` is the text shown
 * on the chip and `key` is the shard it points to, as an absolute path once
 * the shard is known. In a file it is an ordinary Markdown link whose target
 * is the shard's path relative to the linking file's folder, for example
 * `[Plan](../Projects/Plan.md)`, so any Markdown app can follow it and the
 * vault can move as a whole.
 *
 * Older files hold `[Plan](mention:<absolute path>-<n>)` or
 * `[Plan](mention:Plan)`; both still load, and save as relative links.
 */

const SHARD_LINK_KEY = "shard_link";

/**
 * Carries the path of the shard being loaded or saved, which relative links
 * are resolved against and written from.
 */
export const BaseShardLinkPlugin = createSlatePlugin({
  key: SHARD_LINK_KEY,
  options: { filePath: null as string | null },
});

export function setShardLinkFilePath(
  editor: SlateEditor,
  filePath: string | null | undefined,
) {
  editor.setOption(BaseShardLinkPlugin, "filePath", filePath ?? null);
}

function getShardLinkFilePath(editor: SlateEditor | undefined): string | null {
  return editor?.getOption(BaseShardLinkPlugin, "filePath") ?? null;
}

// ── Paths ────────────────────────────────────────────────────────────────────

export function normalizeSlashes(path: string) {
  return path.replace(/\\/g, "/");
}

const DRIVE = /^[A-Za-z]:(?=\/|$)/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** `C:/…`, `/…` or `//server/…`. */
export function isAbsolutePathLike(path: string) {
  const normalized = normalizeSlashes(path);
  return DRIVE.test(normalized) || normalized.startsWith("/");
}

function hasScheme(url: string) {
  return SCHEME.test(url) && !DRIVE.test(normalizeSlashes(url));
}

function decodeTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * Percent-encodes a path the way the backend does when it rewrites links:
 * everything but letters, digits, `-`, `_`, `.` and `~`, segment by segment.
 */
export function encodeShardLinkPath(path: string) {
  return normalizeSlashes(path)
    .split("/")
    .map((segment) =>
      segment === "." || segment === ".."
        ? segment
        : encodeURIComponent(segment).replace(
            /[!'()*]/g,
            (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
          ),
    )
    .join("/");
}

/** Resolves `.` and `..`; keeps a drive or leading slash. */
function normalizePathSegments(path: string) {
  const normalized = normalizeSlashes(path);
  const absolute = normalized.startsWith("/");
  const resolved: string[] = [];

  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      const last = resolved[resolved.length - 1];
      if (resolved.length > 0 && last !== ".." && !DRIVE.test(last)) {
        resolved.pop();
      } else if (!absolute && (resolved.length === 0 || last === "..")) {
        resolved.push("..");
      }
      continue;
    }
    resolved.push(segment);
  }

  return (absolute ? "/" : "") + resolved.join("/");
}

function parentDirectory(filePath: string) {
  const normalized = normalizeSlashes(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

/** Whether a Markdown link target names a shard: a relative path to a `.md` file. */
export function isShardLinkTarget(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return false;
  if (hasScheme(trimmed) || /[#?]/.test(trimmed)) return false;
  return /\.md$/i.test(decodeTarget(trimmed));
}

/**
 * The shard a link target points to: an absolute path when the linking
 * file's path is known, otherwise the target as written.
 */
export function resolveShardLinkKey(url: string, filePath: string | null) {
  const decoded = normalizeSlashes(decodeTarget(url.trim()));
  if (isAbsolutePathLike(decoded)) return normalizePathSegments(decoded);
  if (!filePath) return decoded;
  return normalizePathSegments(`${parentDirectory(filePath)}/${decoded}`);
}

function sameSegment(a: string, b: string) {
  return DRIVE.test(a) && DRIVE.test(b)
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/** The path of `target` relative to the folder of `fromFile`. */
export function relativePath(fromFile: string, target: string) {
  const from = normalizePathSegments(parentDirectory(fromFile))
    .split("/")
    .filter(Boolean);
  const to = normalizePathSegments(target).split("/").filter(Boolean);

  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    sameSegment(from[common], to[common])
  ) {
    common += 1;
  }

  // Different drives share no folder; the only path that works is absolute.
  if (common === 0 && (DRIVE.test(from[0] ?? "") || DRIVE.test(to[0] ?? ""))) {
    return normalizePathSegments(target);
  }

  return [...from.slice(common).map(() => ".."), ...to.slice(common)].join("/");
}

/**
 * The Markdown link target for a mention: its shard's path relative to the
 * file being saved. A target that was never resolved is written as it was
 * read, with `.md` added when a bare name.
 */
export function shardLinkTarget(key: string, filePath: string | null) {
  const normalized = normalizeSlashes(key.trim());
  const path =
    isAbsolutePathLike(normalized) && filePath
      ? relativePath(filePath, normalized)
      : /\.md$/i.test(normalized)
        ? normalized
        : `${normalized}.md`;

  return encodeShardLinkPath(path);
}

/**
 * The shard an old `mention:` link named: `<path>.md-<n>` was the path with
 * the shard's position in the list, `<name>` was just its name.
 */
export function cleanLegacyMentionKey(key: string) {
  const match = /^(.+\.md)-\d+$/i.exec(key.trim());
  return normalizeSlashes(match ? match[1] : key.trim());
}

// ── Rules ────────────────────────────────────────────────────────────────────

type MdNode = { type?: string; value?: string; children?: MdNode[] };

function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

export const shardLinkRules: MdRules = {
  a: {
    deserialize: (node, deco, options) => {
      if (!isShardLinkTarget(node.url)) {
        return defaultRules.a!.deserialize!(node, deco, options);
      }

      const key = resolveShardLinkKey(
        node.url,
        getShardLinkFilePath(options.editor),
      );
      const text = textOf(node as MdNode).trim();

      return {
        type: getPluginType(options.editor!, KEYS.mention),
        value: text || key.split("/").pop()!.replace(/\.md$/i, ""),
        key,
        children: [{ text: "" }],
      } as never;
    },
    serialize: defaultRules.a!.serialize,
  },
  mention: {
    deserialize: (node, _deco, options) => ({
      type: getPluginType(options.editor!, KEYS.mention),
      value: node.displayText || node.username,
      key: cleanLegacyMentionKey(node.username),
      children: [{ text: "" }],
    }),
    serialize: (node, options) => {
      const record = node as Record<string, unknown>;
      const value = typeof record.value === "string" ? record.value : "";
      const key =
        typeof record.key === "string" && record.key.trim() ? record.key : value;

      return {
        type: "link",
        url: shardLinkTarget(key, getShardLinkFilePath(options.editor)),
        children: [{ type: "text", value }],
      } as never;
    },
  },
};
