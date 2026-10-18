import { createSlateEditor, normalizeStaticValue } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SerializationKit } from "@/components/editor/serialization-kit";
import {
  deserializeEditorMarkdown,
  serializeEditorMarkdown,
  type MarkdownFileOptions,
} from "@/lib/editor-markdown";

type Kit = Parameters<typeof createSlateEditor>[0] extends infer O
  ? O extends { plugins?: infer P }
    ? P
    : never
  : never;

/** Loads markdown the way a note is opened (see `resolveSessionValue`). */
export function loadMarkdown(
  markdown: string,
  plugins: Kit = SerializationKit,
  options: MarkdownFileOptions = {},
) {
  return normalizeStaticValue(
    deserializeEditorMarkdown(createSlateEditor({ plugins }), markdown, options),
  ) as any[];
}

/** Serializes a Plate value the way autosave writes it to disk. */
export function saveValue(
  value: any[],
  plugins: Kit = SerializationKit,
  options: MarkdownFileOptions = {},
) {
  return serializeEditorMarkdown(createSlateEditor({ plugins, value }), options);
}

/** One open-and-save cycle with no edits in between. */
export function roundTrip(
  markdown: string,
  plugins: Kit = SerializationKit,
  options: MarkdownFileOptions = {},
) {
  return saveValue(loadMarkdown(markdown, plugins, options), plugins, options);
}

function decodeTarget(url: string) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

const textParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: MdastNode[];
};

/**
 * The words a reader sees in a markdown document (text, code, math, link and
 * image targets), whitespace-normalized. Formatting choices such as `*` vs
 * `-` bullets or escaping don't change it; dropped or mangled content does.
 */
export function readableText(markdown: string): string {
  const parts: string[] = [];

  const visit = (node: MdastNode) => {
    if (typeof node.value === "string") parts.push(node.value);
    // `<a b.md>` and `a%20b.md` are the same target written two ways.
    if (node.url) parts.push(decodeTarget(node.url));
    if (node.alt) parts.push(node.alt);
    node.children?.forEach(visit);
  };

  visit(textParser.parse(markdown) as MdastNode);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
