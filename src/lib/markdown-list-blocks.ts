import { convertNodesSerialize, type MdRules } from "@platejs/markdown";
import { KEYS, type TElement } from "platejs";

/**
 * A list item can hold more than its first line: further paragraphs, a
 * quote or a code block, indented under the item in the file:
 *
 *     - item
 *
 *       More about the item.
 *     - next
 *
 * In the editor those blocks follow the item with one more indent than it.
 * Plate's own save rule only writes the item lines, so the blocks used to
 * end up after the list in an indent wrapper. Before saving, each list that
 * has such blocks is gathered into one node, which is written here as a
 * single Markdown list with the blocks inside their items.
 */

export const LIST_GROUP_KEY = "list_group";

/** What can sit inside a list item and load back where it was. */
const CONTENT_TYPES = new Set<string>([
  KEYS.p,
  ...KEYS.heading,
  KEYS.blockquote,
  KEYS.codeBlock,
]);

const CELL_TYPES = new Set<string>([KEYS.td, KEYS.th]);

/** Formatting other than the indent would need a wrapper, which can't sit in an item. */
const OTHER_FORMATTING = ["align", "lineHeight"] as const;

type Block = TElement & {
  indent?: number;
  listStyleType?: string;
  listStart?: number;
  checked?: boolean;
};

/**
 * The items and their blocks are kept out of `children`, so the indent
 * wrapping that runs after this leaves them alone.
 */
type ListGroup = TElement & { type: typeof LIST_GROUP_KEY; blocks: Block[] };

function isBlock(node: unknown): node is Block {
  return (
    !!node &&
    typeof node === "object" &&
    typeof (node as TElement).type === "string" &&
    Array.isArray((node as TElement).children)
  );
}

function indentOf(node: Block) {
  return typeof node.indent === "number" ? node.indent : 0;
}

function isListItem(node: unknown): node is Block {
  return isBlock(node) && node.type === KEYS.p && !!node.listStyleType && indentOf(node) > 0;
}

function canBeContent(node: Block) {
  return (
    !node.listStyleType &&
    CONTENT_TYPES.has(node.type) &&
    !OTHER_FORMATTING.some((key) => node[key] !== undefined)
  );
}

/**
 * Gathers each list that holds blocks inside its items into a list group,
 * wherever lists sit (a gathered toggle's body included). Lists without
 * such blocks are left to Plate's rule.
 */
export function groupListContent<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const result: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];

    if (isListItem(node)) {
      // The item indents open at this point, so a block knows whose it is.
      const open: number[] = [];
      const run: Block[] = [];
      let hasContent = false;
      let next = index;
      while (next < value.length) {
        const sibling = value[next];
        if (isListItem(sibling)) {
          const indent = indentOf(sibling);
          while (open.length > 0 && open.at(-1)! >= indent) open.pop();
          open.push(indent);
          run.push(sibling);
        } else if (
          isBlock(sibling) &&
          canBeContent(sibling) &&
          open.includes(indentOf(sibling) - 1)
        ) {
          const owner = indentOf(sibling) - 1;
          while (open.at(-1)! > owner) open.pop();
          run.push(sibling);
          hasContent = true;
        } else {
          break;
        }
        next += 1;
      }

      if (hasContent) {
        result.push({
          type: LIST_GROUP_KEY,
          blocks: run,
          children: [{ text: "" }],
        } satisfies ListGroup);
        changed = true;
      } else {
        result.push(...run);
      }
      index = next - 1;
      continue;
    }

    // A table cell's lists have their own rule.
    if (isBlock(node) && !CELL_TYPES.has(node.type)) {
      const body = (node as { body?: unknown }).body;
      const groupedBody = groupListContent(body);
      const children = groupListContent(node.children);
      if (groupedBody !== body || children !== node.children) {
        result.push({
          ...node,
          children,
          ...(groupedBody !== body ? { body: groupedBody } : {}),
        });
        changed = true;
        continue;
      }
    }
    result.push(node);
  }

  return (changed ? result : value) as T;
}

type MdastNode = Record<string, unknown> & { type: string; children: MdastNode[] };

type Frame = { indent: number; styleType: string; list: MdastNode; item: MdastNode | null };

function createList(first: Block): MdastNode {
  return {
    type: "list",
    ordered: first.listStyleType === "decimal",
    start: first.listStart,
    spread: false,
    children: [],
  };
}

type SerializeOptions = Parameters<typeof convertNodesSerialize>[1];

/** The group as one Markdown list, nested the way the indents nest. */
function serializeListGroup(group: ListGroup, options: SerializeOptions): MdastNode {
  const roots: MdastNode[] = [];
  const stack: Frame[] = [];

  const placeList = (list: MdastNode) => {
    const parent = stack.at(-1)?.item;
    if (parent) parent.children.push(list);
    else roots.push(list);
  };

  for (const node of group.blocks) {
    const indent = indentOf(node);

    if (node.listStyleType) {
      while (stack.length > 0 && stack.at(-1)!.indent > indent) stack.pop();
      let frame = stack.at(-1);
      if (frame && frame.indent === indent && frame.styleType !== node.listStyleType) {
        stack.pop();
        frame = undefined;
      }
      if (!frame || frame.indent < indent) {
        frame = { indent, styleType: node.listStyleType, list: createList(node), item: null };
        placeList(frame.list);
        stack.push(frame);
      }
      const item: MdastNode = {
        type: "listItem",
        checked: node.listStyleType === "todo" && node.checked !== undefined ? node.checked : null,
        spread: false,
        children: [
          {
            type: "paragraph",
            children: convertNodesSerialize(node.children, options) as MdastNode[],
          },
        ],
      };
      frame.list.children.push(item);
      frame.item = item;
      continue;
    }

    // A block inside the item one indent up from it.
    while (stack.length > 0 && stack.at(-1)!.indent > indent - 1) stack.pop();
    const item = stack.at(-1)?.item;
    if (!item) continue;
    const { indent: _indent, ...block } = node;
    item.children.push(...(convertNodesSerialize([block as TElement], options) as MdastNode[]));
    // Without a blank line the next paragraph would join the item's line.
    item.spread = true;
  }

  // A list that changes style at its top level is two lists side by side.
  return roots.length === 1 ? roots[0] : { type: "root", children: roots };
}

export const listGroupRules: MdRules = {
  [LIST_GROUP_KEY]: {
    serialize: (node, options) => serializeListGroup(node as ListGroup, options) as never,
  },
};
