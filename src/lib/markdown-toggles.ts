import {
  convertChildrenDeserialize,
  MarkdownPlugin,
  type MdRules,
} from "@platejs/markdown";
import { KEYS, type SlateEditor, type TElement, type TText } from "platejs";

/**
 * Toggles (collapsible blocks) are saved as `<details>`, which GitHub and
 * Obsidian both render as a collapsible block:
 *
 *     <details>
 *     <summary>Title</summary>
 *
 *     Body as normal Markdown.
 *
 *     </details>
 *
 * The blank lines matter: without them other renderers show the body as
 * raw text. A title can't hold Markdown in a `<summary>`, so its marks are
 * written as `<b>`, `<i>`, `<u>`, `<s>` and `<code>`.
 *
 * In the editor a toggle is a block followed by its content: the blocks
 * after it with a higher indent (list items count one level less, since a
 * top-level list already has indent 1). The content is gathered under the
 * toggle before saving and spread out again after loading.
 */

type ToggleNode = TElement & { indent?: number; body?: TElement[] };

const SUMMARY_MARKS: [key: string, tag: string][] = [
  [KEYS.bold, "b"],
  [KEYS.italic, "i"],
  [KEYS.underline, "u"],
  [KEYS.strikethrough, "s"],
  [KEYS.code, "code"],
];

const SUMMARY_TAGS: Record<string, string> = {
  b: KEYS.bold,
  strong: KEYS.bold,
  i: KEYS.italic,
  em: KEYS.italic,
  u: KEYS.underline,
  s: KEYS.strikethrough,
  del: KEYS.strikethrough,
  strike: KEYS.strikethrough,
  code: KEYS.code,
};

function indentOf(node: TElement): number {
  const indent = typeof node.indent === "number" ? node.indent : 0;
  return node.listStyleType && indent > 0 ? indent - 1 : indent;
}

function withIndent(node: TElement, delta: number): TElement {
  const indent = (typeof node.indent === "number" ? node.indent : 0) + delta;
  const { indent: _dropped, ...rest } = node;
  return indent > 0 ? { ...rest, indent } : rest;
}

/**
 * Moves each toggle's content blocks into its `body`, recursively, so the
 * save rule sees the whole toggle. Everything else is returned as is.
 */
export function groupToggles<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  const result: unknown[] = [];
  let changed = false;

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index] as ToggleNode;
    if (!node || typeof node !== "object") {
      result.push(node);
      continue;
    }

    if (node.type === KEYS.toggle) {
      const depth = indentOf(node);
      const body: TElement[] = [];
      let next = index + 1;
      while (next < value.length) {
        const sibling = value[next] as TElement;
        if (!sibling || typeof sibling !== "object" || indentOf(sibling) <= depth) break;
        body.push(withIndent(sibling, -(depth + 1)));
        next += 1;
      }
      result.push({ ...node, body: groupToggles(body) });
      index = next - 1;
      changed = true;
      continue;
    }

    const children = groupToggles(node.children);
    if (children !== node.children) {
      result.push({ ...node, children });
      changed = true;
    } else {
      result.push(node);
    }
  }

  return (changed ? result : value) as T;
}

function escapeHtmlText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function serializeSummary(children: unknown[]): string {
  let html = "";
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const record = child as TText & TElement;
    if (typeof record.text === "string") {
      let text = escapeHtmlText(record.text);
      for (const [key, tag] of SUMMARY_MARKS) {
        if (record[key]) text = `<${tag}>${text}</${tag}>`;
      }
      html += text;
    } else if (Array.isArray(record.children)) {
      html += serializeSummary(record.children);
    }
  }
  return html;
}

function deserializeSummary(
  children: Array<Record<string, unknown>>,
  marks: Record<string, true> = {},
): TText[] {
  const leaves: TText[] = [];
  for (const child of children) {
    if (child.type === "text" && typeof child.value === "string") {
      leaves.push({ ...marks, text: child.value });
    } else if (child.type === "mdxJsxTextElement") {
      const mark = SUMMARY_TAGS[String(child.name)];
      leaves.push(
        ...deserializeSummary(
          (child.children as Array<Record<string, unknown>>) ?? [],
          mark ? { ...marks, [mark]: true } : marks,
        ),
      );
    } else if (Array.isArray(child.children)) {
      leaves.push(...deserializeSummary(child.children, marks));
    } else if (typeof child.value === "string") {
      leaves.push({ ...marks, text: child.value });
    }
  }
  return leaves.length > 0 ? leaves : [{ text: "" }];
}

type MdastNode = Record<string, unknown> & {
  type: string;
  name?: string;
  children?: MdastNode[];
};

/** Splits `<details>` children into the `<summary>` leaves and the body. */
function splitDetails(children: MdastNode[]) {
  let title: TText[] = [{ text: "" }];
  const body: MdastNode[] = [];
  let summaryFound = false;

  for (const child of children) {
    if (!summaryFound) {
      // An empty `<summary></summary>` parses as a flow element, a filled
      // one as a text element inside a paragraph.
      const summary =
        (child.type === "mdxJsxTextElement" || child.type === "mdxJsxFlowElement") &&
        child.name === "summary"
          ? child
          : child.type === "paragraph" &&
              child.children?.length === 1 &&
              child.children[0].type === "mdxJsxTextElement" &&
              child.children[0].name === "summary"
            ? child.children[0]
            : null;
      if (summary) {
        summaryFound = true;
        title = deserializeSummary(summary.children as Array<Record<string, unknown>>);
        continue;
      }
    }
    body.push(child);
  }

  return { title, body };
}

export const toggleRules: MdRules = {
  toggle: {
    serialize: (node, options) => {
      const { body = [], children } = node as ToggleNode;
      const editor = options.editor as SlateEditor;
      const bodyMarkdown = editor
        .getApi(MarkdownPlugin)
        .markdown.serialize({ value: body })
        .replace(/\n+$/, "");
      const summary = serializeSummary(children);
      const value =
        `<details>\n<summary>${summary}</summary>\n\n` +
        (bodyMarkdown ? `${bodyMarkdown}\n\n` : "") +
        "</details>";
      return { type: "html", value } as never;
    },
  },
  details: {
    deserialize: (mdastNode, deco, options) => {
      const { title, body } = splitDetails((mdastNode.children ?? []) as MdastNode[]);
      const toggle: TElement = {
        type: KEYS.toggle,
        children: title,
      };
      const content = (
        convertChildrenDeserialize(body as never, deco, options) as TElement[]
      ).map((block) => withIndent(block, 1));
      return [toggle, ...content] as never;
    },
  },
};
