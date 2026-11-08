import { Fragment, memo, type ReactNode, useMemo, useRef } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { Citation } from "@/lib/open-citation";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { isRemoteAddress } from "@/lib/remote-media";
import { cn } from "@/lib/utils";

const parser = unified().use(remarkParse).use(remarkGfm);

type Node = {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  children?: Node[];
};

export type { Citation };

function shardName(path: string) {
  return getVaultFileDisplayName(path.split("/").pop() ?? path);
}

/** Whether `href` names a web page or other app rather than a vault file. */
function isOutside(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function decode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The shard a link points at, or null for any other link. */
function citationOf(href: string): Citation | null {
  if (!href || isOutside(href) || href.startsWith("#")) return null;
  const hash = href.indexOf("#");
  const path = decode(hash === -1 ? href : href.slice(0, hash))
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
  if (!/\.(md|excalidraw)$/i.test(path)) return null;
  const section = hash === -1 ? null : decode(href.slice(hash + 1)) || null;
  return { path, section };
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Text with nothing to read in it, between or around cites. */
function isBlank(node: Node) {
  return node.type === "text" && !node.value?.trim();
}

function isShardLink(node: Node) {
  return node.type === "link" && !!node.url && citationOf(node.url) !== null;
}

/** Text that may come right after a cite: the end of the clause it backs. */
const CLAUSE_END = /^\s*[.,;!?)]/;

/**
 * Whether the shard link at `index` in `siblings` is a cite: it comes after
 * what it backs and ends that clause, like "came in at 15 MB [1]." Any other
 * shard link is part of the sentence, like "linked from [1]:", and reads as
 * the shard's name.
 */
function isCite(siblings: Node[], index: number) {
  const before = siblings.slice(0, index);
  if (!before.some((node) => !isBlank(node) && !isShardLink(node))) return false;
  for (const node of siblings.slice(index + 1)) {
    if (isBlank(node) || isShardLink(node)) continue;
    return node.type === "text" && CLAUSE_END.test(node.value ?? "");
  }
  return true;
}

/** Each shard link in `tree`, as a cite or as a name in the sentence. */
function shardLinksIn(tree: Node): Map<Node, "cite" | "name"> {
  const found = new Map<Node, "cite" | "name">();
  walk(tree, (node) => {
    const children = node.children ?? [];
    children.forEach((child, index) => {
      if (isShardLink(child)) {
        found.set(child, isCite(children, index) ? "cite" : "name");
      }
    });
  });
  return found;
}

/** The shards an answer cites, numbered in the order they first come. */
function citationsIn(links: Map<Node, "cite" | "name">): Citation[] {
  const found: Citation[] = [];
  for (const [node, use] of links) {
    if (use !== "cite") continue;
    const citation = citationOf(node.url ?? "")!;
    if (!found.some((c) => c.path === citation.path)) found.push(citation);
  }
  return found;
}

/** What a shard link named in a sentence reads as. */
function linkText(node: Node, citation: Citation) {
  const text = (node.children ?? [])
    .map((child) => child.value ?? "")
    .join("")
    .trim();
  // A bare number stands for the shard, so its name says which.
  return text && !/^\d+$/.test(text) ? text : shardName(citation.path);
}

/**
 * An answer's Markdown, parsed once: its tree, the shards it cites in
 * order, and which shard links are cites and which are names.
 */
export type ParsedAnswer = {
  /** The Markdown parsed. */
  source: string;
  tree: Node;
  cited: Citation[];
  links: Map<Node, "cite" | "name">;
};

function hasDefinition(tree: Node) {
  let found = false;
  walk(tree, (node) => {
    if (node.type === "definition") found = true;
  });
  return found;
}

/**
 * `markdown` parsed. When it keeps everything before `previous`'s last
 * block, as an answer streaming in does, those blocks are kept as they
 * were, and only the rest is parsed again. The end may differ, as a
 * streaming answer's unfinished Markdown is closed for the time being.
 */
function parseTree(markdown: string, previous?: ParsedAnswer): Node {
  const blocks = previous?.tree.children ?? [];
  const lastStart =
    previous && blocks.length > 1 ? blocks[blocks.length - 1].position?.start.offset : undefined;
  const from =
    lastStart !== undefined &&
    markdown.slice(0, lastStart) === previous!.source.slice(0, lastStart)
      ? lastStart
      : undefined;
  if (from === undefined) return parser.parse(markdown) as Node;
  const rest = parser.parse(markdown.slice(from)) as Node;
  // A definition can change how earlier blocks read, like `![map][m]`
  // above `[m]: url`: the whole is parsed again.
  if (hasDefinition(rest)) return parser.parse(markdown) as Node;
  walk(rest, (node) => {
    if (node.position?.start.offset !== undefined) node.position.start.offset += from;
    if (node.position?.end.offset !== undefined) node.position.end.offset += from;
  });
  return { type: "root", children: [...blocks.slice(0, -1), ...(rest.children ?? [])] };
}

function parseAnswer(markdown: string, previous?: ParsedAnswer): ParsedAnswer {
  const tree = parseTree(markdown, previous);
  const links = shardLinksIn(tree);
  return { source: markdown, tree, cited: citationsIn(links), links };
}

/** `text` parsed, again only when it changes, and only its end as it grows. */
export function useParsedAnswer(text: string): ParsedAnswer {
  const last = useRef<ParsedAnswer | undefined>(undefined);
  return useMemo(() => {
    last.current = parseAnswer(text, last.current);
    return last.current;
  }, [text]);
}

/**
 * `markdown` for a shard: cites taken out, and shards named in a sentence
 * left as their names.
 */
export function withoutCitations(markdown: string): string {
  const { links } = parseAnswer(markdown);
  const edits: [number, number, string][] = [];
  for (const [node, use] of links) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (use === "name") {
      edits.push([start, end, linkText(node, citationOf(node.url ?? "")!)]);
    } else {
      // With the space before it, so no gap is left behind.
      const from = markdown[start - 1] === " " ? start - 1 : start;
      edits.push([from, end, ""]);
    }
  }
  let text = markdown;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  return text;
}

const CITE_NUMBER =
  "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-[5px] bg-brand/12 px-1 align-[1px] font-medium text-[12px] text-brand leading-4.5";

export function CiteNumber({ number }: { number: number }) {
  return <span className={CITE_NUMBER}>{number}</span>;
}

/**
 * A cite in an answer: the shard's name, then its number in the list under
 * the answer, so it reads without looking down.
 */
function Cite({
  name,
  number,
  label,
  onClick,
}: {
  name: string;
  number: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group text-brand"
    >
      <span className="underline-offset-2 group-hover:underline">{name}</span>
      <span className={cn(CITE_NUMBER, "ml-1 group-hover:bg-brand/20")}>
        {number}
      </span>
    </button>
  );
}

/**
 * One top-level block of an answer. While an answer streams in, the blocks
 * before its last are the same nodes from one batch to the next, so they
 * don't render again.
 */
const Block = memo(
  function Block({ node, render }: { node: Node; render: (node: Node) => ReactNode }) {
    return render(node);
  },
  (previous, next) => previous.node === next.node,
);

/**
 * An answer's Markdown. A cite shows as its number from `cited` and a shard
 * named in a sentence as its name, both opening the shard; other links
 * open as links do elsewhere in the app.
 */
export function AnswerText({
  answer: { tree, cited, links },
  onOpenShard,
  onOpenLink,
}: {
  answer: ParsedAnswer;
  onOpenShard: (citation: Citation) => void;
  onOpenLink: (href: string) => void;
}) {
  // Read when clicked, so blocks that didn't render again open as now.
  const open = useRef({ onOpenShard, onOpenLink });
  open.current = { onOpenShard, onOpenLink };
  // Where `![alt][name]` images point.
  const definitions = useMemo(() => {
    const found = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type === "definition" && node.identifier && node.url) {
        found.set(node.identifier, node.url);
      }
    });
    return found;
  }, [tree]);

  const render = (node: Node, key: number | string): ReactNode => {
    const children = () =>
      (node.children ?? []).map((child, i) => render(child, i));
    switch (node.type) {
      case "paragraph":
        return (
          <p key={key} className="my-0">
            {children()}
          </p>
        );
      case "heading":
        return (
          <p key={key} className="my-0 font-semibold">
            {children()}
          </p>
        );
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return <strong key={key}>{children()}</strong>;
      case "emphasis":
        return <em key={key}>{children()}</em>;
      case "delete":
        return <s key={key}>{children()}</s>;
      case "inlineCode":
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] leading-none"
          >
            {node.value}
          </code>
        );
      case "code":
        return (
          <pre
            key={key}
            className="my-0 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-ui-sm"
          >
            <code>{node.value}</code>
          </pre>
        );
      case "list": {
        const List = node.ordered ? "ol" : "ul";
        return (
          <List
            key={key}
            start={node.ordered ? (node.start ?? undefined) : undefined}
            className={cn(
              "my-0 flex flex-col gap-1 pl-5",
              node.ordered ? "list-decimal" : "list-disc",
            )}
          >
            {children()}
          </List>
        );
      }
      case "listItem":
        return (
          <li key={key} className="[&>p]:inline">
            {children()}
          </li>
        );
      case "blockquote":
        return (
          <blockquote
            key={key}
            className="my-0 border-l-2 pl-3 text-muted-foreground"
          >
            {children()}
          </blockquote>
        );
      case "thematicBreak":
        return <hr key={key} className="my-1 border-border" />;
      case "break":
        return <br key={key} />;
      case "image":
      case "imageReference": {
        // A web address shows too, so adding the answer to a shard brings
        // in nothing the answer didn't show.
        const url =
          node.type === "image"
            ? node.url
            : definitions.get(node.identifier ?? "");
        return (
          <Fragment key={key}>
            {node.alt}
            {isRemoteAddress(url) && (
              <span className="break-all text-muted-foreground">
                {node.alt ? " " : ""}({url.trim()})
              </span>
            )}
          </Fragment>
        );
      }
      case "html":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "table": {
        // Its first row is the header.
        const [head, ...rows] = node.children ?? [];
        return (
          <div key={key} className="overflow-x-auto">
            <table className="w-full border-collapse text-ui-sm">
              {head ? (
                <thead>
                  <tr className="bg-muted">
                    {(head.children ?? []).map((cell, i) => (
                      <th
                        key={i}
                        className="border px-2 py-1 text-left align-top font-medium"
                      >
                        {(cell.children ?? []).map((child, j) => render(child, j))}
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>{rows.map((row, i) => render(row, i))}</tbody>
            </table>
          </div>
        );
      }
      case "tableRow":
        return <tr key={key}>{children()}</tr>;
      case "tableCell":
        return (
          <td key={key} className="border px-2 py-1 align-top">
            {children()}
          </td>
        );
      case "link": {
        const href = node.url ?? "";
        const citation = citationOf(href);
        if (citation && links.get(node) === "name") {
          return (
            <button
              key={key}
              type="button"
              onClick={() => open.current.onOpenShard(citation)}
              className="text-brand underline-offset-2 hover:underline"
            >
              {linkText(node, citation)}
            </button>
          );
        }
        if (citation) {
          const index = cited.findIndex((c) => c.path === citation.path);
          return (
            <Cite
              key={key}
              name={shardName(citation.path)}
              number={index + 1}
              label={`Open ${citation.path}`}
              onClick={() => open.current.onOpenShard(citation)}
            />
          );
        }
        return (
          <a
            key={key}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              open.current.onOpenLink(href);
            }}
            className="text-brand underline-offset-2 hover:underline"
          >
            {children()}
          </a>
        );
      }
      default:
        return <Fragment key={key}>{children()}</Fragment>;
    }
  };

  return (
    <div className="flex flex-col gap-2.5 break-words">
      {(tree.children ?? []).map((node, index) => (
        <Block key={index} node={node} render={(block) => render(block, index)} />
      ))}
    </div>
  );
}
