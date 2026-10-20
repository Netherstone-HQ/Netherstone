import { diffSequences } from "@/lib/sequence-diff";

/**
 * Text that comes back when an earlier version is restored: it's in that
 * version and not in the shard as it is now.
 */
export const ADDED_MARK = "historyAdded";
/** Text that goes away on restore: it's in the shard now, not in the version. */
export const REMOVED_MARK = "historyRemoved";
/** On a top-level block that comes back or goes away as a whole. */
export const BLOCK_CHANGE_KEY = "historyDiff";

export type BlockChange = "added" | "removed";

type Node = Record<string, any>;

const isText = (node: Node) => typeof node.text === "string";

/** A node as text to compare, ignoring generated ids. */
function signature(node: unknown) {
  return JSON.stringify(node, (key, value) =>
    key === "id" ? undefined : value,
  );
}

/** An element's own settings: everything but its id and children. */
function ownProps(node: Node) {
  const { id: _id, children: _children, ...props } = node;
  return signature(props);
}

/** `node` with every text in it marked, and a top-level block flagged. */
function markAll(node: Node, change: BlockChange): Node {
  const mark = change === "added" ? ADDED_MARK : REMOVED_MARK;
  const walk = (child: Node): Node =>
    isText(child)
      ? { ...child, [mark]: true }
      : { ...child, children: (child.children ?? []).map(walk) };
  return { ...walk(node), [BLOCK_CHANGE_KEY]: change };
}

/**
 * The version `version` of a shard laid over the shard as it is now
 * (`current`): what's in both as it is in the version, what only the version
 * has marked as added, what only the shard has now marked as removed. Blocks
 * that changed are compared word by word when they're the same kind.
 */
export function diffShardValues(
  version: Node[],
  current: Node[],
  isInline: (element: Node) => boolean,
): Node[] {
  const inlineOnly = (element: Node) =>
    (element.children ?? []).every(
      (child: Node) => isText(child) || isInline(child),
    );

  const diffBlocks = (versionBlocks: Node[], currentBlocks: Node[]): Node[] => {
    const edits = diffSequences(
      currentBlocks.map(signature),
      versionBlocks.map(signature),
    );
    const merged: Node[] = [];
    let removed: Node[] = [];
    let added: Node[] = [];

    const flush = () => {
      const paired = Math.min(removed.length, added.length);
      for (let i = 0; i < paired; i += 1) {
        merged.push(...diffBlock(added[i], removed[i]));
      }
      merged.push(
        ...removed.slice(paired).map((node) => markAll(node, "removed")),
      );
      merged.push(...added.slice(paired).map((node) => markAll(node, "added")));
      removed = [];
      added = [];
    };

    for (const edit of edits) {
      if (edit.kind === "equal") {
        flush();
        merged.push(versionBlocks[edit.b]);
      } else if (edit.kind === "removed") {
        removed.push(currentBlocks[edit.a]);
      } else {
        added.push(versionBlocks[edit.b]);
      }
    }
    flush();
    return merged;
  };

  const diffBlock = (versionBlock: Node, currentBlock: Node): Node[] => {
    const comparable =
      !isText(versionBlock) &&
      !isText(currentBlock) &&
      versionBlock.type === currentBlock.type &&
      ownProps(versionBlock) === ownProps(currentBlock);
    if (comparable) {
      if (inlineOnly(versionBlock) && inlineOnly(currentBlock)) {
        return [
          {
            ...versionBlock,
            children: diffInline(versionBlock.children, currentBlock.children),
          },
        ];
      }
      if (!inlineOnly(versionBlock) && !inlineOnly(currentBlock)) {
        return [
          {
            ...versionBlock,
            children: diffBlocks(versionBlock.children, currentBlock.children),
          },
        ];
      }
    }
    return [markAll(currentBlock, "removed"), markAll(versionBlock, "added")];
  };

  return diffBlocks(version, current);
}

type Token =
  | { text: string; props: Node; key: string }
  | { node: Node; key: string };

/** Words, single punctuation marks and runs of spaces. */
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokenize(children: Node[]): Token[] {
  const tokens: Token[] = [];
  for (const child of children) {
    if (!isText(child)) {
      tokens.push({ node: child, key: `i${signature(child)}` });
      continue;
    }
    const { text, ...props } = child;
    const marks = signature(props);
    for (const [word] of (text as string).matchAll(TOKEN)) {
      tokens.push({ text: word, props, key: `t${marks}${word}` });
    }
  }
  return tokens;
}

function diffInline(versionChildren: Node[], currentChildren: Node[]): Node[] {
  const version = tokenize(versionChildren);
  const current = tokenize(currentChildren);
  const edits = diffSequences(
    current.map((token) => token.key),
    version.map((token) => token.key),
  );

  const children: Node[] = [];
  const push = (token: Token, mark: string | null) => {
    if ("node" in token) {
      const node = mark
        ? markAll(token.node, mark === ADDED_MARK ? "added" : "removed")
        : token.node;
      const { [BLOCK_CHANGE_KEY]: _, ...inline } = node;
      children.push(inline);
      return;
    }
    const leaf = mark ? { ...token.props, [mark]: true } : token.props;
    const last = children[children.length - 1];
    if (
      last &&
      isText(last) &&
      signature({ ...last, text: "" }) === signature({ ...leaf, text: "" })
    ) {
      last.text += token.text;
    } else {
      children.push({ ...leaf, text: token.text });
    }
  };

  for (const edit of edits) {
    if (edit.kind === "equal") push(version[edit.b], null);
    else if (edit.kind === "removed") push(current[edit.a], REMOVED_MARK);
    else push(version[edit.b], ADDED_MARK);
  }

  return withTextAround(children);
}

/** Inline elements need text on both sides; an element needs a child. */
function withTextAround(children: Node[]): Node[] {
  const result: Node[] = [];
  for (const child of children) {
    const previous = result[result.length - 1];
    if (!isText(child) && (!previous || !isText(previous)))
      result.push({ text: "" });
    result.push(child);
  }
  const last = result[result.length - 1];
  if (!last || !isText(last)) result.push({ text: "" });
  return result;
}

/** True when the merged value shows any difference. */
export function hasChanges(merged: Node[]): boolean {
  const walk = (node: Node): boolean =>
    isText(node)
      ? Boolean(node[ADDED_MARK] || node[REMOVED_MARK])
      : (node.children ?? []).some(walk);
  return merged.some(walk);
}
