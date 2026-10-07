import { MarkdownPlugin } from "@platejs/markdown";
import type { Descendant, SlateEditor } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

// Plate parses markdown as MDX, which is stricter than the plain markdown in a
// vault. Two prose constructs make the MDX parse fail or mangle text:
// - a `<` followed by whitespace, a digit or `=` (e.g. `<1`), which MDX tries
//   to read as a tag
// - any `{`, which MDX reads as a JS expression (and rejects unless valid JS)
// When the MDX parse fails, Plate's recovery path cuts the document at the
// first tag-like `<` and squashes the rest into one block, truncating the note.
//
// Plate also saves a literal `<` as `\<`, but its HTML-to-JSX preprocessing
// ignores that escape and reads up to the next `>` (e.g. a blockquote marker)
// as a tag, dropping content. `\<` and `&lt;` both mean a literal `<`, so
// escaped ones are rewritten to `&lt;` too.
//
// Preceding backslashes are captured to tell escaped characters (odd count)
// from literal backslashes followed by a real `<` or `{` (even count).
const MDX_UNSAFE_PROSE = /\x5c*[<{]/g;

// A `<` followed by these can't open a tag, so it must be literal text.
const NON_TAG_AFTER_LESS_THAN = /[\s0-9=]/;

// An HTML/JSX tag, e.g. `<callout icon="x">` or `<video width={640} />`.
const HTML_TAG = /<\/?[A-Za-z][^>]*>/g;

// Fenced code fence at the start of a code block's source.
const FENCED_CODE_START = /^ {0,3}(?:```|~~~)/;

// Plain CommonMark parser (no MDX) used only to locate code, math and HTML.
const sourceRangeParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

type SourceRange = {
  start: number;
  end: number;
  kind: "verbatim" | "html" | "autolink";
};

// MDX can't parse a `{` inside an autolink, but the bare URL form (which is
// how Plate saves links anyway) parses fine.
const HTTP_AUTOLINK_WITH_BRACE = /^<https?:\/\/[^>]*\{[^>]*>$/i;

type MdastSourceNode = {
  type: string;
  children?: MdastSourceNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

function escapeMdxUnsafeProse(text: string): string {
  return text.replace(
    MDX_UNSAFE_PROSE,
    (match: string, offset: number, source: string) => {
      const backslashes = match.slice(0, -1);
      const isEscaped = backslashes.length % 2 === 1;

      if (match.endsWith("{")) {
        return isEscaped ? match : `${backslashes}\\{`;
      }

      if (isEscaped) {
        return `${backslashes.slice(0, -1)}&lt;`;
      }

      const nextChar = source.charAt(offset + match.length);
      return NON_TAG_AFTER_LESS_THAN.test(nextChar)
        ? `${backslashes}&lt;`
        : match;
    },
  );
}

/** Escapes text between tags in an HTML/JSX block, leaving the tags intact. */
function escapeMdxUnsafeHtmlText(html: string): string {
  let escaped = "";
  let cursor = 0;

  for (const tag of html.matchAll(HTML_TAG)) {
    escaped += escapeMdxUnsafeProse(html.slice(cursor, tag.index));
    escaped += tag[0];
    cursor = tag.index + tag[0].length;
  }

  return escaped + escapeMdxUnsafeProse(html.slice(cursor));
}

function getSourceRangeKind(
  node: MdastSourceNode,
  source: string,
): SourceRange["kind"] | null {
  switch (node.type) {
    case "inlineCode":
    case "math":
    case "inlineMath":
      return "verbatim";
    case "code":
      // MDX has no indented code blocks; it parses them as paragraphs.
      return FENCED_CODE_START.test(source) ? "verbatim" : null;
    case "link":
      // Autolinks (`<https://...>`) and bare URLs don't support backslash
      // escapes; only `[text](url)` links can be escaped safely.
      if (source.startsWith("[")) return null;
      return source.startsWith("<") ? "autolink" : "verbatim";
    case "html":
      return "html";
    default:
      return null;
  }
}

// Stands in for `<` inside code and math while Plate deserializes. Plate's
// htmlToJsx() rewrites every tag-like `<...>` in the raw markdown, code
// included (e.g. `class=` to `className=`, `<Foo />` to `<Foo/>`), before
// parsing. A private-use character it can't match keeps code verbatim; it's
// swapped back to `<` in the deserialized value.
const VERBATIM_LESS_THAN = "\uE000";

/**
 * Prepares vault markdown for Plate's MDX-based deserializer by escaping `<`
 * and `{` in prose, leaving code, math, autolinks and HTML/JSX tags untouched.
 */
export function sanitizeMarkdownInput(markdown: string): string {
  return prepareMarkdownInput(markdown, { maskVerbatim: false });
}

function prepareMarkdownInput(
  markdown: string,
  { maskVerbatim }: { maskVerbatim: boolean },
): string {
  if (!markdown.includes("<") && !markdown.includes("{")) return markdown;

  const ranges: SourceRange[] = [];
  const collectRanges = (node: MdastSourceNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;

    if (start !== undefined && end !== undefined) {
      const kind = getSourceRangeKind(node, markdown.slice(start, end));

      if (kind) {
        ranges.push({ start, end, kind });
        return;
      }
    }

    for (const child of node.children ?? []) {
      collectRanges(child);
    }
  };

  collectRanges(sourceRangeParser.parse(markdown) as MdastSourceNode);

  let sanitized = "";
  let cursor = 0;

  for (const { start, end, kind } of ranges) {
    const source = markdown.slice(start, end);

    sanitized += escapeMdxUnsafeProse(markdown.slice(cursor, start));
    if (kind === "html") {
      sanitized += escapeMdxUnsafeHtmlText(source);
    } else if (kind === "autolink" && HTTP_AUTOLINK_WITH_BRACE.test(source)) {
      sanitized += source.slice(1, -1);
    } else if (kind === "verbatim" && maskVerbatim) {
      sanitized += source.replaceAll("<", VERBATIM_LESS_THAN);
    } else {
      sanitized += source;
    }
    cursor = end;
  }

  return sanitized + escapeMdxUnsafeProse(markdown.slice(cursor));
}

/**
 * Deserializes vault markdown with the editor's MarkdownPlugin.
 *
 * If MDX parsing still fails, the whole document is parsed as plain markdown
 * rather than going through Plate's recovery path, which truncates it. Custom
 * MDX elements (callouts, TOC, ...) then show up as literal text, but no
 * content is lost.
 */
export function deserializeEditorMarkdown(editor: SlateEditor, markdown: string) {
  const api = editor.getApi(MarkdownPlugin).markdown;
  // A note that already contains the placeholder can't be masked safely.
  const maskVerbatim = !markdown.includes(VERBATIM_LESS_THAN);
  const sanitized = prepareMarkdownInput(markdown, { maskVerbatim });
  const masked = maskVerbatim && sanitized.includes(VERBATIM_LESS_THAN);
  const unmask = <T,>(value: T): T =>
    masked ? (restoreVerbatimLessThan(value) as T) : value;
  let mdxError: Error | null = null;

  const value = api.deserialize(sanitized, {
    onError: (error) => {
      mdxError = error;
    },
  });

  if (!mdxError) return stripDeviceMediaProps(unmask(value));

  console.warn(
    "[Netherstone] MDX parse failed; loading the note as plain markdown.",
    mdxError,
  );

  return stripDeviceMediaProps(
    unmask(api.deserialize(sanitized, { withoutMdx: true })),
  );
}

/** Puts back the `<` masked in code and math, in text and node props alike. */
function restoreVerbatimLessThan(value: unknown): unknown {
  if (typeof value === "string") {
    return value.includes(VERBATIM_LESS_THAN)
      ? value.replaceAll(VERBATIM_LESS_THAN, "<")
      : value;
  }

  if (Array.isArray(value)) return value.map(restoreVerbatimLessThan);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        restoreVerbatimLessThan(child),
      ]),
    );
  }

  return value;
}

const TRANSIENT_TYPES = new Set([
  "emoji_input",
  "mention_input",
  "slash_input",
  "placeholder",
]);

const MEDIA_TYPES = new Set(["audio", "file", "img", "video"]);

/**
 * Media props that only describe the file on this device right now: its
 * absolute path, the URL it plays from, and whether it was found. They are
 * worked out again from the stored source, so they are never saved, and are
 * dropped on load from shards that saved them, where they go stale once the
 * file moves or the vault opens on another device.
 */
const DEVICE_MEDIA_PROPS = [
  "netherstoneImportedPath",
  "netherstoneMissing",
  "netherstoneRenderUrl",
  "netherstoneVaultPath",
] as const;

function hasDeviceMediaProps(record: Record<string, unknown>) {
  return DEVICE_MEDIA_PROPS.some((key) => key in record);
}

function withoutDeviceMediaProps(record: Record<string, unknown>) {
  const next = { ...record };
  for (const key of DEVICE_MEDIA_PROPS) delete next[key];
  return next;
}

/** Drops device-specific media props from a loaded editor value. */
export function stripDeviceMediaProps<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next = value.map((node) => {
    if (!node || typeof node !== "object") return node;

    const record = node as Record<string, unknown>;
    const children = stripDeviceMediaProps(record.children);
    const isMedia =
      typeof record.type === "string" &&
      MEDIA_TYPES.has(record.type) &&
      hasDeviceMediaProps(record);
    if (!isMedia && children === record.children) return node;

    changed = true;
    return {
      ...(isMedia ? withoutDeviceMediaProps(record) : record),
      children,
    };
  });

  return (changed ? next : value) as T;
}

function getDurableMediaSource(record: Record<string, unknown>): string | null {
  const storedSource = record.netherstoneStoredSource;
  if (typeof storedSource === "string" && storedSource.trim().length > 0) {
    return storedSource.trim();
  }

  const url = record.url;
  if (typeof url === "string" && url.trim().length > 0) {
    return url.trim();
  }

  return null;
}

export type SerializableEditorValue = Descendant[];

export type SerializableMarkdownPreparation = {
  value: SerializableEditorValue;
};

/**
 * A plain paragraph (not a list item) with no text: the editor's trailing
 * line when it ends the document.
 */
export function isBlankParagraph(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;

  const record = node as Record<string, unknown>;

  return (
    record.type === "p" &&
    !record.listStyleType &&
    Array.isArray(record.children) &&
    record.children.every(
      (child) =>
        !!child &&
        typeof child === "object" &&
        (child as Record<string, unknown>).text === "",
    )
  );
}

export function prepareSerializableMarkdownValue(
  nodes: unknown,
): SerializableMarkdownPreparation {
  const walk = (value: unknown): { changed: boolean; value: unknown } => {
    if (!Array.isArray(value)) {
      return { changed: false, value };
    }

    let next: unknown[] | null = null;

    for (let index = 0; index < value.length; index += 1) {
      const node = value[index];

      if (!node || typeof node !== "object") {
        if (next) {
          next.push(node);
        }
        continue;
      }

      const record = node as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : null;

      if (type && TRANSIENT_TYPES.has(type)) {
        if (!next) {
          next = value.slice(0, index);
        }
        continue;
      }

      const childResult = walk(record.children);
      const durableMediaSource =
        type && MEDIA_TYPES.has(type) ? getDurableMediaSource(record) : null;
      const hasTransientMediaUrl =
        durableMediaSource !== null && durableMediaSource !== record.url;
      const isMediaWithDeviceProps =
        type !== null && MEDIA_TYPES.has(type) && hasDeviceMediaProps(record);

      if (
        childResult.changed ||
        hasTransientMediaUrl ||
        isMediaWithDeviceProps
      ) {
        if (!next) {
          next = value.slice(0, index);
        }

        next.push({
          ...(isMediaWithDeviceProps
            ? withoutDeviceMediaProps(record)
            : record),
          ...(durableMediaSource ? { url: durableMediaSource } : {}),
          children: childResult.changed ? childResult.value : record.children,
        });
        continue;
      }

      if (next) {
        next.push(node);
      }
    }

    if (!next) {
      return { changed: false, value };
    }

    return { changed: true, value: next };
  };

  const result = walk(nodes);
  const value = Array.isArray(result.value)
    ? (result.value as SerializableEditorValue)
    : [];

  // Blank lines at the end of a shard (the editor always keeps one there)
  // aren't content, so they don't reach the file.
  let end = value.length;
  while (end > 0 && isBlankParagraph(value[end - 1])) end -= 1;

  return {
    value: end === value.length ? value : value.slice(0, end),
  };
}

// Plate saves an empty paragraph as a zero-width space so blank lines
// survive a round-trip (`preserveEmptyParagraphs`).
const EMPTY_PARAGRAPHS_ONLY = /^[\s\u200B]*$/;

export function finalizeSerializedMarkdown(markdown: string): string {
  // A note with nothing but empty paragraphs is an empty file, not one
  // holding invisible characters.
  if (EMPTY_PARAGRAPHS_ONLY.test(markdown)) return "";

  return markdown;
}

export function getSerializableMarkdownValue(
  value: unknown,
): SerializableEditorValue {
  return prepareSerializableMarkdownValue(value).value;
}

export function getSerializableEditorValue(
  editor: SlateEditor,
): SerializableEditorValue {
  return getSerializableMarkdownValue(editor.children);
}

export function serializeEditorMarkdown(editor: SlateEditor): string {
  const preparation = prepareSerializableMarkdownValue(editor.children);
  const serialized = editor.getApi(MarkdownPlugin).markdown.serialize({
    value: preparation.value,
  });

  return finalizeSerializedMarkdown(serialized);
}

export function getSaveMarkdownContent(
  editor: SlateEditor | null,
  fallbackMarkdown: string,
): string {
  if (!editor) {
    return fallbackMarkdown;
  }

  return serializeEditorMarkdown(editor);
}
