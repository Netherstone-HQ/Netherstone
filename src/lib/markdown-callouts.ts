import {
  convertChildrenDeserialize,
  convertNodesSerialize,
  defaultRules,
  type MdRules,
} from "@platejs/markdown";
import { KEYS, type TElement, type TText } from "platejs";

/**
 * Callouts are saved as the callout form most Markdown apps render, a
 * blockquote that starts with its type:
 *
 *     > [!tip] Optional title
 *     > Body as normal Markdown.
 *
 * The type comes from the callout's emoji; an emoji with no type of its own
 * is written as the type itself (`> [!🔥]`) so it comes back the same. A
 * title is read as a bold first line, and a bold first line is written back
 * as the title. Callouts saved as `<callout icon="…">` tags before this
 * still load, and are written in this form on the next save.
 */

export const DEFAULT_CALLOUT_ICON = "💡";

/** The emoji for each callout type; the first type listed for an emoji is the one saved. */
export const CALLOUT_ICONS: Record<string, string> = {
  note: "📝",
  info: "ℹ️",
  todo: "☑️",
  abstract: "📌",
  summary: "📌",
  tldr: "📌",
  tip: "💡",
  hint: "💡",
  important: "💡",
  success: "✅",
  check: "✅",
  done: "✅",
  question: "❓",
  help: "❓",
  faq: "❓",
  warning: "⚠️",
  caution: "⚠️",
  attention: "⚠️",
  failure: "❌",
  fail: "❌",
  missing: "❌",
  danger: "🚫",
  error: "🚫",
  bug: "🐞",
  example: "📋",
  quote: "💬",
  cite: "💬",
};

const CALLOUT_TYPES = new Map<string, string>();
for (const [type, icon] of Object.entries(CALLOUT_ICONS)) {
  if (!CALLOUT_TYPES.has(icon)) CALLOUT_TYPES.set(icon, type);
}

// `[!tip]`, optionally folded (`[!tip]-`), at the start of a blockquote.
const MARKER = /^\[!([^\]\s]+)\][+-]?[ \t]*/;
const WORD_TYPE = /^[A-Za-z-]+$/;

/** The emoji a callout type stands for. */
export function calloutIcon(type: string): string {
  if (!WORD_TYPE.test(type)) return type;
  return CALLOUT_ICONS[type.toLowerCase()] ?? DEFAULT_CALLOUT_ICON;
}

function calloutType(icon: unknown): string {
  const emoji = typeof icon === "string" && icon ? icon : DEFAULT_CALLOUT_ICON;
  return CALLOUT_TYPES.get(emoji) ?? emoji;
}

type MdastNode = { type: string; value?: string; children?: MdastNode[] };

/** Splits a paragraph's inline nodes at its first line break. */
function splitFirstLine(nodes: MdastNode[]): [MdastNode[], MdastNode[]] {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === "break") {
      return [nodes.slice(0, index), nodes.slice(index + 1)];
    }
    const at = node.type === "text" ? (node.value ?? "").indexOf("\n") : -1;
    if (at >= 0) {
      const value = node.value!;
      return [
        [...nodes.slice(0, index), { ...node, value: value.slice(0, at) }],
        [{ ...node, value: value.slice(at + 1) }, ...nodes.slice(index + 1)],
      ];
    }
  }
  return [nodes, []];
}

function withoutEmptyText(nodes: MdastNode[]): MdastNode[] {
  return nodes.filter((node) => node.type !== "text" || node.value!.trim() !== "");
}

/** The callout's first block when it is one bold line, which is saved as the title. */
function boldTitle(children: TElement[]): TText[] | null {
  const first = children[0];
  if (!first || first.type !== KEYS.p) return null;
  const texts = first.children as TText[];
  const isTitle = texts.every(
    (child) =>
      typeof child.text === "string" &&
      !child.text.includes("\n") &&
      (child[KEYS.bold] === true || child.text === ""),
  );
  return isTitle && texts.some((child) => child.text.trim()) ? texts : null;
}

function isEmptyCallout(children: TElement[]): boolean {
  return (
    children.length === 1 &&
    children[0].type === KEYS.p &&
    (children[0].children as TText[]).every((child) => child.text === "")
  );
}

export const calloutRules: MdRules = {
  blockquote: {
    deserialize: (node, deco, options) => {
      const first = node.children?.[0] as MdastNode | undefined;
      const lead = first?.type === "paragraph" ? first.children?.[0] : undefined;
      const marker = lead?.type === "text" ? MARKER.exec(lead.value ?? "") : null;
      if (!first || !lead || !marker) {
        return defaultRules.blockquote!.deserialize!(node, deco, options);
      }

      const [title, body] = splitFirstLine([
        { ...lead, value: lead.value!.slice(marker[0].length) },
        ...first.children!.slice(1),
      ]);
      const titleNodes = withoutEmptyText(title);
      const bodyNodes = withoutEmptyText(body);
      const blocks: MdastNode[] = [
        ...(titleNodes.length
          ? [{ type: "paragraph", children: [{ type: "strong", children: titleNodes }] }]
          : []),
        ...(bodyNodes.length ? [{ type: "paragraph", children: bodyNodes }] : []),
        ...(node.children!.slice(1) as MdastNode[]),
      ];

      return {
        type: KEYS.callout,
        icon: calloutIcon(marker[1]),
        children: blocks.length
          ? convertChildrenDeserialize(blocks as never, deco, options)
          : [{ type: KEYS.p, children: [{ text: "" }] }],
      } as never;
    },
  },
  callout: {
    serialize: (node, options) => {
      const { children, type: _type, id: _id, icon, ...rest } = node as TElement;
      // Anything besides the emoji has no place in the marker, so such a
      // callout keeps the tag form rather than lose it. A new callout comes
      // with `variant: undefined`, which isn't anything.
      if (Object.values(rest).some((prop) => prop !== undefined)) {
        return defaultRules.callout!.serialize!(node, options);
      }

      const marker = `[!${calloutType(icon)}]`;
      // A new callout holds one empty line, which needs nothing past the marker.
      const blocks = isEmptyCallout(children as TElement[]) ? [] : (children as TElement[]);
      const title = boldTitle(blocks);
      const body = convertNodesSerialize(
        title ? blocks.slice(1) : blocks,
        options,
      ) as unknown as MdastNode[];

      if (title) {
        const plain = title.map(({ [KEYS.bold]: _bold, ...text }) => text);
        const [line] = convertNodesSerialize(
          [{ type: KEYS.p, children: plain }] as never,
          options,
        ) as unknown as MdastNode[];
        body.unshift({
          type: "paragraph",
          children: [{ type: "html", value: `${marker} ` }, ...(line?.children ?? [])],
        });
      } else if (body[0]?.type === "paragraph") {
        body[0] = {
          ...body[0],
          children: [{ type: "html", value: `${marker}\n` }, ...body[0].children!],
        };
      } else {
        body.unshift({ type: "paragraph", children: [{ type: "html", value: marker }] });
      }

      return { type: "blockquote", children: body } as never;
    },
  },
};
