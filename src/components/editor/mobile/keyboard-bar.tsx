import * as React from "react";
import { createPortal } from "react-dom";

import { useIndentButton, useOutdentButton } from "@platejs/indent/react";
import {
  useLinkToolbarButton,
  useLinkToolbarButtonState,
} from "@platejs/link/react";
import { ListStyleType, someList, toggleList } from "@platejs/list";
import {
  useIndentTodoToolBarButton,
  useIndentTodoToolBarButtonState,
} from "@platejs/list/react";
import {
  BaselineIcon,
  BoldIcon,
  Code2Icon,
  HighlighterIcon,
  IndentIcon,
  ItalicIcon,
  KeyboardIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  OutdentIcon,
  QuoteIcon,
  Redo2Icon,
  SparklesIcon,
  SquarePlusIcon,
  StrikethroughIcon,
  TypeIcon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import { KEYS } from "platejs";
import {
  type PlateEditor,
  useEditorReadOnly,
  useEditorRef,
  useEditorSelector,
  useFocused,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
} from "platejs/react";

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
import { FontColorToolbarButton } from "@/components/ui/font-color-toolbar-button";
import { insertGroups } from "@/components/ui/insert-toolbar-button";
import { phoneMediaGroup } from "./insert-media";
import { Toolbar } from "@/components/ui/toolbar";
import { androidBridge } from "@/lib/android-bridge";
import { hasInlineAsk, openInlineAsk } from "@/lib/inline-ask";
import { useKeyboard } from "@/lib/system-insets";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";

const BULLETS = [
  ListStyleType.Disc,
  ListStyleType.Circle,
  ListStyleType.Square,
];
const NUMBERS = [ListStyleType.Decimal];

/** Keeps the editor's focus, and so the keyboard and caret, when a button is tapped. */
const keepFocus = {
  onPointerDown: (event: React.PointerEvent) => event.preventDefault(),
  onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
};

/** A 48 px button of the keyboard bar. */
function BarButton({
  label,
  pressed,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-label"> & {
  label: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-[10px] text-foreground outline-none disabled:opacity-40 aria-pressed:bg-accent [&_svg]:size-5",
        className,
      )}
      {...keepFocus}
      {...props}
    >
      {children}
    </button>
  );
}

/** A button in one of the style panel's segmented rows. */
function SegmentButton({
  label,
  pressed,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-label"> & {
  label?: string;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className="flex h-full min-w-0 flex-1 items-center justify-center border-r border-border text-[15px] whitespace-nowrap text-foreground outline-none last:border-r-0 disabled:opacity-40 aria-pressed:bg-accent aria-pressed:font-semibold [&_svg]:size-5"
      {...keepFocus}
      {...props}
    >
      {children}
    </button>
  );
}

function Segments({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 overflow-hidden rounded-xl border border-border bg-card">
      {children}
    </div>
  );
}

function useBlockType() {
  return useEditorSelector((editor) => {
    if (!editor.selection) return KEYS.p;
    const types = new Set(
      getTurnIntoBlocks(editor).map(([node]) => getBlockType(node)),
    );
    return types.size === 1 ? [...types][0] : undefined;
  }, []);
}

function MarkSegment({
  nodeType,
  label,
  icon,
}: {
  nodeType: string;
  label: string;
  icon: React.ReactNode;
}) {
  const state = useMarkToolbarButtonState({ nodeType });
  const { props } = useMarkToolbarButton(state);
  return (
    <SegmentButton
      label={label}
      pressed={props.pressed}
      onClick={props.onClick}
    >
      {icon}
    </SegmentButton>
  );
}

function useListToggle(styles: ListStyleType[], style: ListStyleType) {
  const editor = useEditorRef();
  const pressed = useEditorSelector((editor) => someList(editor, styles), []);
  return {
    pressed,
    onClick: () => toggleList(editor, { listStyleType: style }),
  };
}

function useTodoToggle() {
  const state = useIndentTodoToolBarButtonState({ nodeType: KEYS.listTodo });
  const { props } = useIndentTodoToolBarButton(state);
  return { pressed: props.pressed, onClick: props.onClick };
}

function useLinkButton() {
  const state = useLinkToolbarButtonState();
  const { props } = useLinkToolbarButton(state);
  return { pressed: props.pressed, onClick: props.onClick };
}

const HEADINGS = [
  { value: KEYS.p, label: "Text" },
  { value: "h1", label: "H1" },
  { value: "h2", label: "H2" },
  { value: "h3", label: "H3" },
];

const MARKS = [
  { nodeType: KEYS.bold, label: "Bold", icon: <BoldIcon /> },
  { nodeType: KEYS.italic, label: "Italic", icon: <ItalicIcon /> },
  { nodeType: KEYS.underline, label: "Underline", icon: <UnderlineIcon /> },
  {
    nodeType: KEYS.strikethrough,
    label: "Strikethrough",
    icon: <StrikethroughIcon />,
  },
  { nodeType: KEYS.code, label: "Code", icon: <Code2Icon /> },
];

/** Text style, in the keyboard's place: block types, marks, lists and spacing. */
function StylePanel({ height }: { height: number }) {
  const editor = useEditorRef();
  const blockType = useBlockType();
  const bullets = useListToggle(BULLETS, ListStyleType.Disc);
  const numbers = useListToggle(NUMBERS, ListStyleType.Decimal);
  const todo = useTodoToggle();
  const link = useLinkButton();
  const { props: indent } = useIndentButton();
  const { props: outdent } = useOutdentButton();
  const quoted = blockType === KEYS.blockquote;

  return (
    <div
      role="group"
      aria-label="Text style"
      className="flex shrink-0 flex-col gap-3 overflow-y-auto bg-sidebar px-4 pt-4"
      style={{ height }}
    >
      <Segments>
        {HEADINGS.map(({ value, label }) => (
          <SegmentButton
            key={value}
            pressed={blockType === value}
            onClick={() => setBlockType(editor, value)}
          >
            {label}
          </SegmentButton>
        ))}
      </Segments>
      <Segments>
        {MARKS.map((mark) => (
          <MarkSegment key={mark.nodeType} {...mark} />
        ))}
      </Segments>
      <Segments>
        <SegmentButton label="Bulleted list" {...bullets}>
          <ListIcon />
        </SegmentButton>
        <SegmentButton label="Numbered list" {...numbers}>
          <ListOrderedIcon />
        </SegmentButton>
        <SegmentButton label="To-do list" {...todo}>
          <ListTodoIcon />
        </SegmentButton>
        <SegmentButton
          label="Quote"
          pressed={quoted}
          onClick={() =>
            setBlockType(editor, quoted ? KEYS.p : KEYS.blockquote)
          }
        >
          <QuoteIcon />
        </SegmentButton>
      </Segments>
      <Segments>
        <SegmentButton label="Outdent" onClick={outdent.onClick}>
          <OutdentIcon />
        </SegmentButton>
        <SegmentButton label="Indent" onClick={indent.onClick}>
          <IndentIcon />
        </SegmentButton>
        <MarkSegment
          nodeType={KEYS.highlight}
          label="Highlight"
          icon={<HighlighterIcon />}
        />
        {/* The desktop color picker, which lives in a toolbar. */}
        <Toolbar className="flex h-full min-w-0 flex-1 items-center justify-center border-r border-border [&_button]:size-full [&_button]:rounded-none">
          <FontColorToolbarButton nodeType={KEYS.color} tooltip="Text color">
            <BaselineIcon />
          </FontColorToolbarButton>
        </Toolbar>
        <SegmentButton label="Link" {...link}>
          <LinkIcon />
        </SegmentButton>
      </Segments>
    </div>
  );
}

/** The desktop Insert menu, with media picked from the phone or its camera. */
const phoneInsertGroups = insertGroups.map((group) =>
  group.group === phoneMediaGroup.group ? phoneMediaGroup : group,
);

/** Everything Insert offers on a phone, as a sheet. */
function InsertSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editor = useEditorRef();
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Insert"
      height="half"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        editor.tf.focus();
      }}
    >
      {phoneInsertGroups.map(({ group, items }, index) => (
        <div key={group} role="group" aria-label={group}>
          {index > 0 && <BottomSheetSeparator />}
          {items.map(({ icon, label, value, onSelect }) => (
            <BottomSheetItem
              key={value}
              icon={icon}
              onClick={() => {
                onOpenChange(false);
                onSelect(editor, value);
              }}
            >
              {label}
            </BottomSheetItem>
          ))}
        </div>
      ))}
    </BottomSheet>
  );
}

/**
 * Shows or hides the keyboard while the editor keeps focus. Elsewhere than
 * Android, refocusing makes the browser pick up the new `inputmode`.
 */
function setKeyboard(editor: PlateEditor, shown: boolean) {
  const android = androidBridge();
  if (android) {
    android.setKeyboard(shown);
    return;
  }
  editor.api.toDOMNode(editor)?.blur();
  editor.tf.focus();
}

/** The bar above the phone's keyboard while typing in a shard. */
export function KeyboardBar() {
  const editor = useEditorRef();
  const readOnly = useEditorReadOnly();
  const focused = useFocused();
  const keyboard = useKeyboard();
  const [styles, setStyles] = React.useState(false);
  const [insertOpen, setInsertOpen] = React.useState(false);

  const canUndo = useEditorSelector(
    (editor) => editor.history.undos.length > 0,
    [],
  );
  const canRedo = useEditorSelector(
    (editor) => editor.history.redos.length > 0,
    [],
  );
  const hasSelection = useEditorSelector(
    (editor) => !editor.api.isCollapsed(),
    [],
  );
  const assistant =
    useAssistantStore((s) => s.enabled === true) && hasInlineAsk(editor);
  const bullets = useListToggle(BULLETS, ListStyleType.Disc);
  const numbers = useListToggle(NUMBERS, ListStyleType.Decimal);
  const todo = useTodoToggle();
  const link = useLinkButton();

  const closeStyles = React.useCallback(
    (showKeyboard: boolean) => {
      editor.api.toDOMNode(editor)?.removeAttribute("inputmode");
      setStyles(false);
      if (showKeyboard) setKeyboard(editor, true);
    },
    [editor],
  );

  const openStyles = () => {
    // No keyboard for the editor while it keeps the caret.
    editor.api.toDOMNode(editor)?.setAttribute("inputmode", "none");
    setStyles(true);
    setKeyboard(editor, false);
  };

  // A tap in the text brings the keyboard back; leaving the shard closes the
  // panel. Focus may go to the panel's own menus, such as Text color.
  React.useEffect(() => {
    if (!styles) return;
    const element = editor.api.toDOMNode(editor);
    const onTextTap = () => closeStyles(false);
    const onFocusOut = (event: FocusEvent) => {
      const to = event.relatedTarget;
      const staysInPanel =
        to instanceof Element &&
        (element?.contains(to) ||
          to.closest(
            "[data-keyboard-bar], [data-radix-popper-content-wrapper]",
          ));
      if (!staysInPanel) closeStyles(false);
    };
    element?.addEventListener("pointerdown", onTextTap);
    element?.addEventListener("focusout", onFocusOut);
    return () => {
      element?.removeEventListener("pointerdown", onTextTap);
      element?.removeEventListener("focusout", onFocusOut);
      // Never leaves the editor without a keyboard, also when the shard closes.
      element?.removeAttribute("inputmode");
    };
  }, [styles, editor, closeStyles]);

  const shown = !readOnly && (styles || (focused && keyboard.inset > 0));

  // Where the keyboard was: the panel takes its height, at least enough
  // for its four rows.
  const panelHeight = Math.max(keyboard.lastHeight, PANEL_MIN_HEIGHT);
  const bottom = keyboard.pageAboveKeyboard || styles ? 0 : keyboard.inset;

  // On the page itself, so no panel of the app's can sit over it.
  return (
    <>
      {shown &&
        createPortal(
          <div
            data-keyboard-bar
            className="fixed inset-x-0 z-40 flex flex-col border-t border-border bg-sidebar text-ui"
            style={{ bottom }}
          >
            <div
              role="toolbar"
              aria-label="Formatting"
              className="flex h-12 items-center"
            >
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto pl-1 [scrollbar-width:none]">
                <BarButton
                  label="Undo"
                  disabled={!canUndo}
                  onClick={() => editor.undo()}
                >
                  <Undo2Icon />
                </BarButton>
                <BarButton
                  label="Redo"
                  disabled={!canRedo}
                  onClick={() => editor.redo()}
                >
                  <Redo2Icon />
                </BarButton>
                <Divider />
                <BarButton
                  label="Text style"
                  pressed={styles}
                  onClick={() => (styles ? closeStyles(true) : openStyles())}
                >
                  <TypeIcon />
                </BarButton>
                {assistant && (
                  <BarButton
                    label="Ask the assistant"
                    disabled={!hasSelection}
                    onClick={() => openInlineAsk(editor)}
                  >
                    <SparklesIcon />
                  </BarButton>
                )}
                <BarButton label="Bulleted list" {...bullets}>
                  <ListIcon />
                </BarButton>
                <BarButton label="To-do list" {...todo}>
                  <ListTodoIcon />
                </BarButton>
                <BarButton label="Link" {...link}>
                  <LinkIcon />
                </BarButton>
                <BarButton label="Insert" onClick={() => setInsertOpen(true)}>
                  <SquarePlusIcon />
                </BarButton>
                <BarButton label="Numbered list" {...numbers}>
                  <ListOrderedIcon />
                </BarButton>
              </div>
              <Divider />
              <BarButton
                label="Hide keyboard"
                onClick={() => {
                  closeStyles(false);
                  editor.tf.blur();
                }}
              >
                <KeyboardIcon />
              </BarButton>
            </div>
            {styles && <StylePanel height={panelHeight} />}
          </div>,
          document.body,
        )}
      <InsertSheet open={insertOpen} onOpenChange={setInsertOpen} />
    </>
  );
}

/** The style panel's four rows with their gaps, when no keyboard height is known yet. */
const PANEL_MIN_HEIGHT = 4 * 48 + 4 * 12 + 16;

function Divider() {
  return (
    <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
  );
}
