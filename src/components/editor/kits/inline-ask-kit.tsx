import { useMemo } from "react";
import {
  PointApi,
  RangeApi,
  TextApi,
  type DecoratedRange,
  type TElement,
  type TText,
} from "platejs";
import {
  createPlatePlugin,
  Plate,
  PlateLeaf,
  type PlateLeafProps,
  useEditorRef,
  usePlateEditor,
} from "platejs/react";

import { InlineAsk } from "@/components/assistant/InlineAsk";
import {
  isInlineElement,
  VersionPreviewKit,
} from "@/components/history/history-diff-kit";
import { Editor as PlateEditor } from "@/components/ui/editor";
import { diffShardValues } from "@/lib/history-diff";
import { INLINE_ASK_KEY, inlineAskBlock, inlineAskRange } from "@/lib/inline-ask";
import { remoteMediaIn, withRemoteMediaAsLinks } from "@/lib/remote-media";
import { useInlineAskStore } from "@/store/inline-ask";

/** How a piece of the text asked about looks. */
type Look = "tint" | "removed" | "block";

/** Text with marks, as the shard shows it. */
function Marked({ node }: { node: TText }) {
  let content: React.ReactNode = node.text;
  if (node.code) {
    content = (
      <code className="whitespace-pre-wrap rounded-md bg-muted px-[0.3em] py-[0.2em] font-mono text-sm">
        {content}
      </code>
    );
  }
  if (node.bold) content = <strong>{content}</strong>;
  if (node.italic) content = <em>{content}</em>;
  if (node.underline) content = <u>{content}</u>;
  if (node.strikethrough) content = <s>{content}</s>;
  return content;
}

function InlineNodes({ nodes }: { nodes: (TElement | TText)[] }) {
  return nodes.map((node, index) =>
    TextApi.isText(node) ? (
      <Marked key={index} node={node} />
    ) : (
      <InlineNodes key={index} nodes={node.children} />
    ),
  );
}

/** What comes in for part of a block, after what goes. */
function AddedInline() {
  const preview = useInlineAskStore((s) => s.preview) as TElement[] | null;
  if (!preview?.[0]) return null;
  return (
    <span
      contentEditable={false}
      data-inline-ask-preview=""
      className="slate-historyAdded history-added preview-in font-reading!"
    >
      <InlineNodes nodes={preview[0].children} />
    </span>
  );
}

/** The preview's plugins: no empty line to type into at its end. */
const PREVIEW_PLUGINS = VersionPreviewKit.filter(
  (plugin) => plugin.key !== "trailingLine",
);

/** What comes in for whole blocks, after the last of them. */
function AddedBlocks() {
  const shard = useEditorRef();
  const preview = useInlineAskStore((s) => s.preview) as TElement[] | null;
  const value = useMemo(
    () =>
      diffShardValues(
        // Media from the web the shard doesn't have shows as its address.
        withRemoteMediaAsLinks(preview ?? [], remoteMediaIn(shard.children)),
        [],
        isInlineElement,
        { wholeBlocks: true },
      ) as TElement[],
    [preview, shard],
  );
  const editor = usePlateEditor({
    plugins: PREVIEW_PLUGINS,
    value,
    readOnly: true,
    navigationFeedback: false,
  });
  return (
    <div contentEditable={false} data-inline-ask-preview="">
      <Plate editor={editor} readOnly>
        <PlateEditor
          variant="none"
          className="overflow-visible! font-reading! text-(length:--reading-size) leading-relaxed"
          readOnly
          aria-label="Change to the selection"
        />
      </Plate>
    </div>
  );
}

/** A top-level block, wrapped as removed while whole blocks are previewed. */
function AskBlock({
  element,
  children,
}: {
  element: TElement;
  children: React.ReactNode;
}) {
  const editor = useEditorRef();
  const previewing = useInlineAskStore((s) => s.phase === "preview" && s.whole);
  const at = previewing
    ? inlineAskBlock(editor, editor.api.findPath(element) ?? [])
    : null;
  if (!at) return children;
  return (
    <div className="change-preview preview-in">
      <div data-history-block="removed">{children}</div>
      {at === "last" ? <AddedBlocks /> : null}
    </div>
  );
}

function InlineAskLeaf(props: PlateLeafProps) {
  const leaf = props.leaf as { askLook?: Look; askAdded?: boolean };
  if (leaf.askLook === "tint") {
    return (
      <PlateLeaf {...props} className="rounded-[2px] bg-brand/25">
        {props.children}
      </PlateLeaf>
    );
  }
  if (leaf.askLook === "removed") {
    return (
      <PlateLeaf {...props}>
        <del className="slate-historyRemoved history-removed preview-in">
          {props.children}
        </del>
        {leaf.askAdded ? <AddedInline /> : null}
      </PlateLeaf>
    );
  }
  return <PlateLeaf {...props}>{props.children}</PlateLeaf>;
}

/**
 * Inline Ask in the shard: the selection tinted while the prompt is open,
 * then the answer previewed in place, with section 5's looks. The shard
 * itself doesn't change until Apply.
 */
export const InlineAskKit = [
  createPlatePlugin({
    key: INLINE_ASK_KEY,
    node: { isLeaf: true, component: InlineAskLeaf },
    decorate: ({ editor, entry: [node, path] }) => {
      const range = inlineAskRange(editor);
      if (!range || !TextApi.isText(node)) return [];
      const own = editor.api.range(path);
      const hit = own && RangeApi.intersection(range, own);
      if (!hit || RangeApi.isCollapsed(hit)) return [];
      const { phase, whole } = useInlineAskStore.getState();
      const piece = (at: { anchor: any; focus: any }, look: Look, extra = {}) =>
        ({ ...at, [INLINE_ASK_KEY]: true, askLook: look, ...extra }) as DecoratedRange;
      if (phase !== "preview") return [piece(hit, "tint")];
      if (whole) return [piece(hit, "block")];

      // What comes in shows after the last character that goes.
      const last = PointApi.equals(RangeApi.end(hit), RangeApi.end(range));
      return [piece(hit, "removed", last ? { askAdded: true } : {})];
    },
    render: {
      // Each top-level block listens for the preview, since a change of
      // decorations alone redraws its text and not the block.
      aboveNodes: ({ path, element }) =>
        path.length === 1
          ? ({ children }) => <AskBlock element={element}>{children}</AskBlock>
          : undefined,
      afterEditable: () => <InlineAsk />,
    },
  }),
];
