import { Fragment, type ReactNode, useMemo } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { cn } from "@/lib/utils";

const parser = unified().use(remarkParse).use(remarkGfm);

type Node = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  children?: Node[];
};

/** A shard an answer cites: a vault-relative path and maybe a section. */
export interface Citation {
  path: string;
  section: string | null;
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

/** The shards `markdown` cites, numbered in the order they first come. */
export function citationsIn(markdown: string): Citation[] {
  const found: Citation[] = [];
  walk(parser.parse(markdown) as Node, (node) => {
    if (node.type !== "link" || !node.url) return;
    const citation = citationOf(node.url);
    if (citation && !found.some((c) => c.path === citation.path)) {
      found.push(citation);
    }
  });
  return found;
}

export function CiteNumber({
  number,
  onClick,
  label,
}: {
  number: number;
  onClick?: () => void;
  label?: string;
}) {
  const className =
    "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-[5px] bg-brand/12 px-1 align-[1px] font-medium text-[12px] text-brand leading-4.5";
  if (!onClick) return <span className={className}>{number}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(className, "mx-0.5 hover:bg-brand/20")}
    >
      {number}
    </button>
  );
}

/**
 * An answer's Markdown. Links to shards show as their number from `cited`
 * and open the shard; other links open as links do elsewhere in the app.
 */
export function AnswerText({
  text,
  cited,
  onOpenShard,
  onOpenLink,
}: {
  text: string;
  cited: Citation[];
  onOpenShard: (citation: Citation) => void;
  onOpenLink: (href: string) => void;
}) {
  const tree = useMemo(() => parser.parse(text) as Node, [text]);

  const render = (node: Node, key: number | string): ReactNode => {
    const children = () =>
      (node.children ?? []).map((child, i) => render(child, i));
    switch (node.type) {
      case "root":
        return <Fragment key={key}>{children()}</Fragment>;
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
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
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
        return <Fragment key={key}>{node.alt}</Fragment>;
      case "html":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "table":
        return (
          <div key={key} className="overflow-x-auto">
            <table className="w-full border-collapse text-ui-sm">
              <tbody>{children()}</tbody>
            </table>
          </div>
        );
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
        if (citation) {
          const index = cited.findIndex((c) => c.path === citation.path);
          return (
            <CiteNumber
              key={key}
              number={index + 1}
              label={`Open ${citation.path}`}
              onClick={() => onOpenShard(citation)}
            />
          );
        }
        return (
          <a
            key={key}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              onOpenLink(href);
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
    <div className="flex flex-col gap-2.5 break-words">{render(tree, "root")}</div>
  );
}
