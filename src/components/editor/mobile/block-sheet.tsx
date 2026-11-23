import * as React from "react";

import { BlockSelectionPlugin } from "@platejs/selection/react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  IndentIcon,
  OutdentIcon,
  Repeat2Icon,
  Trash2Icon,
} from "lucide-react";
import { KEYS, type TElement } from "platejs";
import { useEditorReadOnly, useEditorRef, useFocused } from "platejs/react";

import {
  getBlockType,
  getTurnIntoBlocks,
  setBlockType,
} from "@/components/transforms";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { turnIntoItems } from "@/components/ui/turn-into-toolbar-button";
import { useKeyboard } from "@/lib/system-insets";

type Page = "main" | "turn-into" | "align";

const ALIGNS = [
  { value: "left", label: "Left", icon: <AlignLeftIcon /> },
  { value: "center", label: "Center", icon: <AlignCenterIcon /> },
  { value: "right", label: "Right", icon: <AlignRightIcon /> },
] as const;

/** The sheet's title: what the block is, as the Insert menu names it. */
function blockName(block: TElement) {
  const type = getBlockType(block);
  if (type === KEYS.p) return "Paragraph";
  return turnIntoItems.find((item) => item.value === type)?.label ?? "Block";
}

/**
 * The block menu on a phone. A long press on a block while the keyboard is
 * down opens it; while typing, a long press selects text as usual.
 */
export function BlockSheet() {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  const focused = useFocused();
  const { inset } = useKeyboard();
  // The block the sheet is for, by id, so edits elsewhere don't retarget it.
  const [blockId, setBlockId] = React.useState<string | null>(null);
  // Kept while the sheet slides away, so it keeps its name.
  const [title, setTitle] = React.useState("");
  const [page, setPage] = React.useState<Page>("main");
  const typing = focused && inset > 0;

  React.useEffect(() => {
    const element = editor.api.toDOMNode(editor);
    if (!element || readOnly || typing) return;

    const onLongPress = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const blockElement = target?.closest<HTMLElement>(
        '[data-slate-node="element"]',
      );
      if (!blockElement) return;
      const node = editor.api.toSlateNode(blockElement);
      const path = node && editor.api.findPath(node);
      if (!path) return;

      const id = (editor.children[path[0]] as TElement).id as
        | string
        | undefined;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      editor.getApi(BlockSelectionPlugin).blockSelection.set([id]);
      setPage("main");
      setTitle(blockName(editor.children[path[0]] as TElement));
      setBlockId(id);
    };

    element.addEventListener("contextmenu", onLongPress, { capture: true });
    return () =>
      element.removeEventListener("contextmenu", onLongPress, {
        capture: true,
      });
  }, [editor, readOnly, typing]);

  const found =
    blockId === null
      ? -1
      : editor.children.findIndex((node) => node.id === blockId);
  const index = found === -1 ? null : found;
  const block =
    index === null ? undefined : (editor.children[index] as TElement);
  const close = () => {
    setBlockId(null);
    editor.getApi(BlockSelectionPlugin).blockSelection.deselect();
  };
  const at = index === null ? [] : [index];
  const blockSelection =
    editor.getTransforms(BlockSelectionPlugin).blockSelection;
  const canTurnInto =
    !!block && getTurnIntoBlocks(editor, [[block, at]]).length > 0;

  const run = (action: () => void) => {
    action();
    close();
  };

  return (
    <BottomSheet
      open={!!block}
      onOpenChange={(open) => !open && close()}
      title={title}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      {block && page === "main" && (
        <>
          <BottomSheetItem
            icon={<Repeat2Icon />}
            end={<ChevronRightIcon />}
            disabled={!canTurnInto}
            onClick={() => setPage("turn-into")}
          >
            Turn into
          </BottomSheetItem>
          <BottomSheetItem
            icon={<ArrowUpIcon />}
            disabled={index === 0}
            onClick={() =>
              run(() => editor.tf.moveNodes({ at, to: [index! - 1] }))
            }
          >
            Move up
          </BottomSheetItem>
          <BottomSheetItem
            icon={<ArrowDownIcon />}
            disabled={index === editor.children.length - 1}
            onClick={() =>
              run(() => editor.tf.moveNodes({ at, to: [index! + 1] }))
            }
          >
            Move down
          </BottomSheetItem>
          <BottomSheetItem
            icon={<CopyIcon />}
            onClick={() => run(() => blockSelection.duplicate())}
          >
            Duplicate
          </BottomSheetItem>
          <BottomSheetItem
            icon={<IndentIcon />}
            onClick={() => run(() => blockSelection.setIndent(1))}
          >
            Indent
          </BottomSheetItem>
          <BottomSheetItem
            icon={<OutdentIcon />}
            onClick={() => run(() => blockSelection.setIndent(-1))}
          >
            Outdent
          </BottomSheetItem>
          <BottomSheetItem
            icon={<AlignLeftIcon />}
            end={<ChevronRightIcon />}
            onClick={() => setPage("align")}
          >
            Align
          </BottomSheetItem>
          <BottomSheetSeparator />
          <BottomSheetItem
            danger
            icon={<Trash2Icon />}
            onClick={() => run(() => editor.tf.removeNodes({ at }))}
          >
            Delete
          </BottomSheetItem>
        </>
      )}
      {block && page !== "main" && (
        <BottomSheetItem
          icon={<ChevronLeftIcon />}
          onClick={() => setPage("main")}
        >
          {page === "turn-into" ? "Turn into" : "Align"}
        </BottomSheetItem>
      )}
      {block &&
        page === "turn-into" &&
        turnIntoItems.map(({ icon, label, value }) => (
          <BottomSheetItem
            key={value}
            icon={icon}
            end={getBlockType(block) === value ? <CheckIcon /> : undefined}
            onClick={() =>
              run(() => setBlockType(editor, value, { entries: [[block, at]] }))
            }
          >
            {label}
          </BottomSheetItem>
        ))}
      {block &&
        page === "align" &&
        ALIGNS.map(({ value, label, icon }) => (
          <BottomSheetItem
            key={value}
            icon={icon}
            end={(block.align ?? "left") === value ? <CheckIcon /> : undefined}
            onClick={() => run(() => blockSelection.setNodes({ align: value }))}
          >
            {label}
          </BottomSheetItem>
        ))}
    </BottomSheet>
  );
}
