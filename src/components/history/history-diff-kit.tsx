import { DndPlugin } from "@platejs/dnd";
import { createSlateEditor } from "platejs";
import {
  createPlatePlugin,
  PlateElement,
  type PlateElementProps,
  PlateLeaf,
  type PlateLeafProps,
  type RenderNodeWrapper,
} from "platejs/react";

import { EditorKit } from "@/components/editor/editor-kit";
import {
  ADDED_MARK,
  BLOCK_CHANGE_KEY,
  GAP_BLOCK,
  GAP_INLINE,
  REMOVED_MARK,
} from "@/lib/history-diff";
import { useEditorStore } from "@/store/editor";

function AddedLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} className="history-added">
      {props.children}
    </PlateLeaf>
  );
}

function RemovedLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="del" className="history-removed">
      {props.children}
    </PlateLeaf>
  );
}

/** Where the other of two versions has text this one doesn't. */
function GapInline(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="span">
      <span contentEditable={false} className="history-gap" />
      {props.children}
    </PlateElement>
  );
}

/** Where the other of two versions has a block this one doesn't. */
function GapBlock(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <div contentEditable={false} className="history-gap-block" />
      {props.children}
    </PlateElement>
  );
}

/**
 * A top-level block that comes back or goes away whole, so it can be hidden
 * with "Show changes" off, and images and other blocks without text can be
 * outlined.
 */
const BlockChange: RenderNodeWrapper = ({ editor, element, path }) => {
  const change = element[BLOCK_CHANGE_KEY];
  if (path.length !== 1 || (change !== "added" && change !== "removed")) {
    return undefined;
  }
  const isVoid = editor.api.isVoid(element);
  return ({ children }) => (
    <div data-history-block={change} data-void={isVoid ? "" : undefined}>
      {children}
    </div>
  );
};

const HistoryDiffKit = [
  createPlatePlugin({
    key: ADDED_MARK,
    node: { isLeaf: true, component: AddedLeaf },
  }),
  createPlatePlugin({
    key: REMOVED_MARK,
    node: { isLeaf: true, component: RemovedLeaf },
  }),
  createPlatePlugin({
    key: GAP_INLINE,
    node: { isElement: true, isInline: true, isVoid: true, component: GapInline },
  }),
  createPlatePlugin({
    key: GAP_BLOCK,
    node: { isElement: true, isVoid: true, component: GapBlock },
  }),
  createPlatePlugin({
    key: BLOCK_CHANGE_KEY,
    render: { aboveNodes: BlockChange },
  }),
];

/** Editing aids an earlier version, which can't be edited, has no use for. */
const EDIT_ONLY_PLUGINS = new Set<string>([
  "fixed-toolbar",
  "floating-toolbar",
  DndPlugin.key,
]);

/** The editor's plugins for showing an earlier version, read-only. */
export const VersionPreviewKit = [
  ...EditorKit.filter((plugin) => !EDIT_ONLY_PLUGINS.has(plugin.key)),
  ...HistoryDiffKit,
];

let staticEditor: ReturnType<typeof createSlateEditor> | null = null;

/** Which elements sit inside a line of text, as the editor sees them. */
export function isInlineElement(element: any) {
  const editor =
    useEditorStore.getState().plateEditor ??
    (staticEditor ??= createSlateEditor({ plugins: EditorKit }));
  return editor.api.isInline(element);
}
