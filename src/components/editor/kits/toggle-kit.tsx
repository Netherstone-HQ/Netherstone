"use client";

import * as React from "react";

import { buildToggleIndex, TogglePlugin } from "@platejs/toggle/react";
import type { TElement } from "platejs";
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

function HiddenBlocksProvider({ children }: { children: React.ReactNode }) {
  const openIds = usePluginOption(TogglePlugin, "openIds") ?? NO_IDS;
  const hidden = useEditorSelector(
    (editor) => findHiddenBlockIds(editor.children as TElement[], openIds),
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

export const ToggleKit = [
  ...IndentKit,
  TogglePlugin.configure({
    render: {
      aboveEditable: HiddenBlocksProvider,
      aboveNodes: () => HiddenInToggle,
    },
  }).withComponent(ToggleElement),
];
