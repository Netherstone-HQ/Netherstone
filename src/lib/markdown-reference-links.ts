import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Reference-style links (`[docs][d]` with `[d]: https://…` below) have no
 * node in the editor, so they are rewritten to inline links before parsing.
 * The text, URL and title all stay; only the form changes, once.
 */

const parser = unified().use(remarkParse).use(remarkGfm);

type Position = { start: { offset?: number }; end: { offset?: number } };

type MdastNode = {
  type: string;
  identifier?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  referenceType?: "shortcut" | "collapsed" | "full";
  children?: MdastNode[];
  position?: Position;
};

type Replacement = { start: number; end: number; text: string };

function linkTarget(url: string, title: string | null | undefined): string {
  const target = /[\s()]/.test(url) || url === "" ? `<${url}>` : url;
  if (!title) return target;
  return `${target} "${title.replaceAll('"', '\\"')}"`;
}

/** Rewrites every resolvable reference link and image to its inline form. */
export function inlineReferenceLinks(markdown: string): string {
  // Cheap exit: a definition is the only way a reference resolves.
  if (!/^[ \t]{0,3}\[[^\]]+\]:/m.test(markdown)) return markdown;

  const tree = parser.parse(markdown) as MdastNode;
  const definitions = new Map<string, { url: string; title?: string | null }>();
  const definitionNodes: MdastNode[] = [];
  const references: MdastNode[] = [];

  const visit = (node: MdastNode) => {
    if (node.type === "definition" && node.identifier) {
      if (!definitions.has(node.identifier)) {
        definitions.set(node.identifier, { url: node.url ?? "", title: node.title });
      }
      definitionNodes.push(node);
      return;
    }
    if (node.type === "linkReference" || node.type === "imageReference") {
      references.push(node);
      // Nested references inside link text are not rewritten.
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);

  const replacements: Replacement[] = [];

  for (const reference of references) {
    const definition = reference.identifier
      ? definitions.get(reference.identifier)
      : undefined;
    const start = reference.position?.start.offset;
    const end = reference.position?.end.offset;
    if (!definition || start === undefined || end === undefined) continue;

    const target = linkTarget(definition.url, definition.title);

    if (reference.type === "imageReference") {
      replacements.push({ start, end, text: `![${reference.alt ?? ""}](${target})` });
      continue;
    }

    const children = reference.children ?? [];
    const first = children[0]?.position?.start.offset;
    const last = children.at(-1)?.position?.end.offset;
    // A shortcut reference (`[docs]`) has its label as text.
    const text =
      first !== undefined && last !== undefined
        ? markdown.slice(first, last)
        : markdown.slice(start + 1, markdown.indexOf("]", start));
    replacements.push({ start, end, text: `[${text}](${target})` });
  }

  if (replacements.length === 0) return markdown;

  for (const definition of definitionNodes) {
    const start = definition.position?.start.offset;
    let end = definition.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    // Take the line break with the definition, so no blank line is left.
    if (markdown[end] === "\r") end += 1;
    if (markdown[end] === "\n") end += 1;
    replacements.push({ start, end, text: "" });
  }

  replacements.sort((a, b) => b.start - a.start);

  let result = markdown;
  for (const { start, end, text } of replacements) {
    result = result.slice(0, start) + text + result.slice(end);
  }

  // Definitions usually sit at the end; don't leave trailing blank lines.
  return result.replace(/\n{3,}$/, "\n\n").replace(/\n\n$/, "\n");
}
