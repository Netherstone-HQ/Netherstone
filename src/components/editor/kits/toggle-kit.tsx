import * as React from "react";

import { buildToggleIndex, TogglePlugin } from "@platejs/toggle/react";
import {
  ElementApi,
  KEYS,
  NodeApi,
  PathApi,
  type Descendant,
  type Operation,
  type Path,
  type SlateEditor,
  type TElement,
} from "platejs";
import { useEditorSelector, usePluginOption } from "platejs/react";

import { IndentKit } from "@/components/editor/kits/indent-kit";
import { ToggleElement } from "@/components/ui/toggle-node";

/**
 * Which blocks a closed toggle hides, worked out once per change for the
 * whole shard and handed to the blocks through a context.
 *
 * Plate's own version gives every block its own subscription to the
 * document, so each keystroke in a shard of thousands of blocks paid for
 * thousands of checks. Here the set of hidden blocks is rebuilt once per
 * change, and the blocks only hear about it when the set actually changes,
 * which typing never does.
 */
const NO_IDS: ReadonlySet<string> = new Set();
const HiddenBlocksContext = React.createContext<ReadonlySet<string>>(NO_IDS);

function findHiddenBlockIds(
  blocks: TElement[],
  openIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const [id, enclosingToggleIds] of buildToggleIndex(blocks)) {
    if (!enclosingToggleIds.every((toggleId) => openIds.has(toggleId))) {
      hidden.add(id as string);
    }
  }
  return hidden;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * How many toggles each editor holds, counted once on first use and then
 * kept in step by `apply`, so a shard without toggles skips the index.
 */
const toggleCounts = new WeakMap<SlateEditor, number>();

function isToggle(node: { type?: unknown }) {
  return node.type === KEYS.toggle;
}

function togglesIn(node: Descendant) {
  if (!ElementApi.isElement(node)) return 0;
  // `elements` starts with the node itself.
  let count = 0;
  for (const [element] of NodeApi.elements(node)) if (isToggle(element)) count++;
  return count;
}

function toggleChange(operation: Operation) {
  switch (operation.type) {
    case "insert_node":
      return togglesIn(operation.node);
    case "remove_node":
      return -togglesIn(operation.node);
    case "split_node":
      return isToggle(operation.properties) ? 1 : 0;
    case "merge_node":
      return isToggle(operation.properties) ? -1 : 0;
    case "set_node":
      return (
        Number(isToggle(operation.newProperties)) -
        Number(isToggle(operation.properties))
      );
    default:
      return 0;
  }
}

export function hasToggles(editor: SlateEditor) {
  let count = toggleCounts.get(editor);
  if (count === undefined) {
    count = editor.children.reduce((sum, node) => sum + togglesIn(node), 0);
    toggleCounts.set(editor, count);
  }
  return count > 0;
}

function HiddenBlocksProvider({ children }: { children: React.ReactNode }) {
  const openIds = usePluginOption(TogglePlugin, "openIds") ?? NO_IDS;
  const hidden = useEditorSelector(
    (editor) =>
      hasToggles(editor)
        ? findHiddenBlockIds(editor.children as TElement[], openIds)
        : NO_IDS,
    [openIds],
    { equalityFn: sameIds },
  );

  return (
    <HiddenBlocksContext.Provider value={hidden}>{children}</HiddenBlocksContext.Provider>
  );
}

const hiddenStyle: React.CSSProperties = {
  height: 0,
  margin: 0,
  overflow: "hidden",
  visibility: "hidden",
};

function HiddenInToggle({
  children,
  element,
}: {
  children: React.ReactNode;
  element: TElement;
}) {
  const hidden = React.useContext(HiddenBlocksContext);
  if (!hidden.has(element.id as string)) return children;
  return <div style={hiddenStyle}>{children}</div>;
}

/** The ids of the toggles at `path` and inside it. */
function toggleIdsAt(editor: SlateEditor, path: Path): string[] {
  const node = NodeApi.get<TElement>(editor, path);
  if (!ElementApi.isElement(node)) return [];
  const elements: TElement[] = [node];
  for (const [element] of NodeApi.elements(node)) elements.push(element);
  return elements
    .filter((element) => element.type === KEYS.toggle && typeof element.id === "string")
    .map((element) => element.id as string);
}

export const ToggleKit = [
  ...IndentKit,
  TogglePlugin.configure({
    render: {
      aboveEditable: HiddenBlocksProvider,
      aboveNodes: () => HiddenInToggle,
    },
  })
    .overrideEditor(({ api, editor, tf: { apply } }) => ({
      transforms: {
        /**
         * A toggle made while editing (from a menu, by turning a block into
         * one, by Enter at the end of one, or by pasting) starts open, so
         * what is typed next shows. Toggles loaded from a file never pass
         * through here and stay closed.
         */
        apply(operation) {
          apply(operation);

          const count = toggleCounts.get(editor);
          if (count !== undefined) {
            toggleCounts.set(editor, count + toggleChange(operation));
          }

          let path: Path | undefined;
          if (operation.type === "insert_node") path = operation.path;
          else if (operation.type === "split_node") path = PathApi.next(operation.path);
          else if (
            operation.type === "set_node" &&
            operation.newProperties.type === KEYS.toggle
          ) {
            path = operation.path;
          }
          if (!path) return;

          const ids = toggleIdsAt(editor, path);
          if (ids.length > 0) api.toggle.toggleIds(ids, true);
        },
      },
    }))
    .withComponent(ToggleElement),
];
