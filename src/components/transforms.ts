"use client";

import type { PlateEditor } from "platejs/react";

import { insertCallout } from "@platejs/callout";
import { insertCodeBlock } from "@platejs/code-block";
import { insertDate } from "@platejs/date";
import {
  columnsToWidths,
  insertColumnGroup,
  toggleColumnGroup,
} from "@platejs/layout";
import { triggerFloatingLink } from "@platejs/link/react";
import { insertEquation, insertInlineEquation } from "@platejs/math";
import {
  insertAudioPlaceholder,
  insertFilePlaceholder,
  insertMedia,
  insertVideoPlaceholder,
} from "@platejs/media";
import { TablePlugin } from "@platejs/table/react";
import { insertToc } from "@platejs/toc";
import {
  type NodeEntry,
  type Path,
  type TElement,
  KEYS,
  PathApi,
} from "platejs";

import {
  DIAGRAM_LANG,
  DIAGRAM_STARTER,
  markNewDiagram,
} from "@/lib/mermaid-diagram";

const ACTION_THREE_COLUMNS = "action_three_columns";
export const ACTION_DIAGRAM = "action_diagram";

const LIST_PROPS = [KEYS.listType, KEYS.listStart, KEYS.listChecked];

const insertList = (editor: PlateEditor, type: string) => {
  editor.tf.insertNodes(
    editor.api.create.block({
      indent: 1,
      listStyleType: type,
    }),
    { select: true },
  );
};

/** A Mermaid code block with a starter diagram, the code selected at its end. */
const insertDiagram = (editor: PlateEditor) => {
  insertCodeBlock(editor, { select: true });
  const block = editor.api.above({ match: { type: KEYS.codeBlock } });
  if (!block) return;

  const [node, path] = block;
  if (typeof node.id === "string") markNewDiagram(node.id);
  editor.tf.setNodes({ lang: DIAGRAM_LANG }, { at: path });
  editor.tf.replaceNodes(
    DIAGRAM_STARTER.split("\n").map((line) => ({
      children: [{ text: line }],
      type: KEYS.codeLine,
    })),
    { at: path, children: true },
  );
  editor.tf.select(path, { edge: "end" });
};

const insertBlockMap: Record<
  string,
  (editor: PlateEditor, type: string) => void
> = {
  [KEYS.listTodo]: insertList,
  [KEYS.ol]: insertList,
  [KEYS.ul]: insertList,
  [ACTION_THREE_COLUMNS]: (editor) =>
    insertColumnGroup(editor, { columns: 3, select: true }),
  [ACTION_DIAGRAM]: insertDiagram,
  [KEYS.audio]: (editor) => insertAudioPlaceholder(editor, { select: true }),
  [KEYS.callout]: (editor) => insertCallout(editor, { select: true }),
  [KEYS.codeBlock]: (editor) => insertCodeBlock(editor, { select: true }),
  [KEYS.equation]: (editor) => insertEquation(editor, { select: true }),
  [KEYS.file]: (editor) => insertFilePlaceholder(editor, { select: true }),
  [KEYS.img]: (editor) =>
    insertMedia(editor, {
      select: true,
      type: KEYS.img,
    }),
  [KEYS.mediaEmbed]: (editor) =>
    insertMedia(editor, {
      select: true,
      type: KEYS.mediaEmbed,
    }),
  [KEYS.table]: (editor) =>
    editor.getTransforms(TablePlugin).insert.table({}, { select: true }),
  [KEYS.toc]: (editor) => insertToc(editor, { select: true }),
  [KEYS.video]: (editor) => insertVideoPlaceholder(editor, { select: true }),
};

const insertInlineMap: Record<
  string,
  (editor: PlateEditor, type: string) => void
> = {
  [KEYS.date]: (editor) => insertDate(editor, { select: true }),
  [KEYS.inlineEquation]: (editor) =>
    insertInlineEquation(editor, "", { select: true }),
  [KEYS.link]: (editor) => triggerFloatingLink(editor, { focused: true }),
};

/** What a list item can hold under its first line, as saved in Markdown. */
const LIST_CONTENT_TYPES = new Set<string>([
  KEYS.p,
  ...KEYS.heading,
  KEYS.blockquote,
  KEYS.codeBlock,
]);

/**
 * A block inserted from a list item, or from a block inside one, stays in
 * that item: one indent deeper than the item, like the blocks under it.
 * A list inserted there continues the list at the item's level.
 */
const keepInListItem = (
  editor: PlateEditor,
  from: TElement,
  fromPath: Path,
  type: string,
) => {
  if (typeof from.indent !== "number" || from.indent < 1) return;

  const isList = type === KEYS.ul || type === KEYS.ol || type === KEYS.listTodo;
  const isInItem = !!from[KEYS.listType] || LIST_CONTENT_TYPES.has(from.type);
  if (!isInItem || (!isList && !LIST_CONTENT_TYPES.has(type))) return;

  const indent = isList || !from[KEYS.listType] ? from.indent : from.indent + 1;
  const at = editor.selection?.anchor.path.slice(0, fromPath.length);
  if (!at) return;

  editor.tf.unsetNodes([...LIST_PROPS, "indent"], {
    at,
    match: (_, path) => path.length > at.length,
  });
  editor.tf.setNodes({ indent }, { at });
};

type InsertBlockOptions = {
  upsert?: boolean;
};

export const insertBlock = (
  editor: PlateEditor,
  type: string,
  options: InsertBlockOptions = {},
) => {
  const { upsert = false } = options;

  editor.tf.withoutNormalizing(() => {
    const block = editor.api.block();

    if (!block) return;

    const [currentNode, path] = block;
    const isCurrentBlockEmpty = editor.api.isEmpty(currentNode);
    const currentBlockType = getBlockType(currentNode);

    const isSameBlockType = type === currentBlockType;

    if (upsert && isCurrentBlockEmpty && isSameBlockType) {
      return;
    }

    if (type in insertBlockMap) {
      insertBlockMap[type](editor, type);
    } else {
      editor.tf.insertNodes(editor.api.create.block({ type }), {
        at: PathApi.next(path),
        select: true,
      });
    }

    keepInListItem(editor, currentNode, path, type);

    if (!isSameBlockType) {
      editor.tf.removeNodes({ previousEmptyBlock: true });
    }
  });
};

export const insertInlineElement = (editor: PlateEditor, type: string) => {
  if (insertInlineMap[type]) {
    insertInlineMap[type](editor, type);
  }
};

const setList = (
  editor: PlateEditor,
  type: string,
  entry: NodeEntry<TElement>,
) => {
  editor.tf.setNodes(
    editor.api.create.block({
      indent: 1,
      listStyleType: type,
    }),
    {
      at: entry[1],
    },
  );
};

const setBlockMap: Record<
  string,
  (editor: PlateEditor, type: string, entry: NodeEntry<TElement>) => void
> = {
  [KEYS.listTodo]: setList,
  [KEYS.ol]: setList,
  [KEYS.ul]: setList,
};

/** What Turn into can change: blocks whose content is text. */
const TURN_INTO_TYPES = new Set<string>([
  KEYS.p,
  ...KEYS.heading,
  KEYS.blockquote,
  KEYS.toggle,
  KEYS.codeBlock,
]);

/** Blocks Turn into wraps lines in, and unwraps when turning them into something else. */
const WRAPPER_TYPES = new Set<string>([KEYS.blockquote, KEYS.codeBlock]);

/**
 * The blocks Turn into acts on for these entries (the selection's blocks by
 * default): a code line or a quote's paragraph stands for the whole code
 * block or quote. Anything else (math, media, tables and their cells) is
 * left out, since renaming it would lose its content.
 */
export const getTurnIntoBlocks = (
  editor: PlateEditor,
  entries: Iterable<NodeEntry<TElement>> = editor.api.blocks<TElement>({
    mode: "lowest",
  }),
) => {
  const blocks: NodeEntry<TElement>[] = [];

  for (const entry of entries) {
    const block =
      editor.api.above<TElement>({
        at: entry[1],
        match: (node) => WRAPPER_TYPES.has((node as TElement).type),
      }) ?? entry;
    const [node, path] = block;

    if (!TURN_INTO_TYPES.has(node.type)) continue;
    if (editor.api.some({ at: path, match: { type: editor.getType(KEYS.table) } })) {
      continue;
    }
    if (blocks.some(([, other]) => PathApi.equals(other, path))) continue;

    blocks.push(block);
  }

  return blocks;
};

/**
 * Unwraps a quote or code block into its lines, so each can take the new
 * type. A block inside a list item passes its indent on to its lines.
 */
const unwrapLines = (editor: PlateEditor, [node, path]: NodeEntry<TElement>) => {
  if (!WRAPPER_TYPES.has(node.type)) return [editor.api.pathRef(path)];

  const indent = node.indent;
  const lineCount = node.children.length;

  const isLine = (_: unknown, linePath: Path) =>
    linePath.length === path.length + 1;

  if (node.type === KEYS.codeBlock) {
    editor.tf.setNodes({ type: KEYS.p }, { at: path, match: isLine });
  }
  if (indent !== undefined && !node[KEYS.listType]) {
    editor.tf.setNodes({ indent }, { at: path, match: isLine });
  }
  editor.tf.unwrapNodes({ at: path });

  return Array.from({ length: lineCount }, (_, index) =>
    editor.api.pathRef([...PathApi.parent(path), path.at(-1)! + index]),
  );
};

/** Wraps each run of neighbouring lines in one quote or code block. */
const wrapLines = (editor: PlateEditor, type: string, paths: Path[]) => {
  const runs: Path[][] = [];

  for (const path of paths) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && PathApi.equals(PathApi.next(last), path)) {
      run.push(path);
    } else {
      runs.push([path]);
    }
  }

  // Last run first, so wrapping doesn't move the runs still to come.
  for (const run of runs.reverse()) {
    const first = editor.api.node<TElement>(run[0])![0];
    // A block inside a list item keeps its place there; a list item leaves its list.
    const indent = first[KEYS.listType] ? undefined : first.indent;
    const parentPath = PathApi.parent(run[0]);
    const isLine = (_: unknown, path: Path) =>
      path.length === run[0].length && PathApi.isChild(path, parentPath);
    const at = {
      anchor: editor.api.start(run[0])!,
      focus: editor.api.end(run.at(-1)!)!,
    };

    editor.tf.unsetNodes([...LIST_PROPS, "indent"], { at, match: isLine });
    editor.tf.setNodes(
      { type: type === KEYS.codeBlock ? KEYS.codeLine : KEYS.p },
      { at, match: isLine },
    );
    editor.tf.wrapNodes(
      { type, children: [], ...(indent === undefined ? {} : { indent }) },
      { at, match: isLine },
    );
  }
};

/** Moves the whole block into the first of three columns. */
const putInColumns = (editor: PlateEditor, [node, path]: NodeEntry<TElement>) => {
  const columnGroupType = editor.getType(KEYS.columnGroup);
  if (editor.api.above({ at: path, match: { type: columnGroupType } })) {
    toggleColumnGroup(editor, { at: path, columns: 3 });
    return;
  }

  editor.tf.replaceNodes(
    {
      type: columnGroupType,
      children: columnsToWidths({ columns: 3 }).map((width, index) => ({
        type: editor.getType(KEYS.column),
        width,
        children: [index === 0 ? node : editor.api.create.block()],
      })),
    },
    { at: path },
  );
  editor.tf.select(editor.api.start([...path, 0])!);
};

export const setBlockType = (
  editor: PlateEditor,
  type: string,
  { entries }: { entries?: Iterable<NodeEntry<TElement>> } = {},
) => {
  const blocks = getTurnIntoBlocks(editor, entries);
  if (blocks.length === 0) return;

  editor.tf.withoutNormalizing(() => {
    if (type === ACTION_THREE_COLUMNS) {
      putInColumns(editor, blocks[0]);
      return;
    }

    const lineRefs = blocks
      .map(([, path]) => editor.api.pathRef(path))
      .flatMap((ref) => {
        const path = ref.unref();
        const entry = path && editor.api.node<TElement>(path);
        if (!entry || getBlockType(entry[0]) === type) return [];
        return unwrapLines(editor, entry);
      });
    const paths = lineRefs
      .map((ref) => ref.unref())
      .filter((path): path is Path => !!path);

    if (WRAPPER_TYPES.has(type)) {
      wrapLines(editor, type, paths);
      return;
    }

    for (const path of paths) {
      const node = editor.api.node<TElement>(path)?.[0];
      if (!node) continue;

      if (node[KEYS.listType]) {
        editor.tf.unsetNodes([...LIST_PROPS, "indent"], { at: path });
      }
      if (type in setBlockMap) {
        setBlockMap[type](editor, type, [node, path]);
      } else if (node.type !== type) {
        editor.tf.setNodes({ type }, { at: path });
      }
    }
  });
};

export const getBlockType = (block: TElement) => {
  if (block[KEYS.listType]) {
    if (block[KEYS.listType] === KEYS.ol) {
      return KEYS.ol;
    }
    if (block[KEYS.listType] === KEYS.listTodo) {
      return KEYS.listTodo;
    }
    return KEYS.ul;
  }

  return block.type;
};
