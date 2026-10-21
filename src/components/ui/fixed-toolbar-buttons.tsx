"use client";

import * as React from "react";

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
  useToggleToolbarButton,
  useToggleToolbarButtonState,
} from "@platejs/toggle/react";
import {
  ALargeSmallIcon,
  BaselineIcon,
  BoldIcon,
  Code2Icon,
  FolderUpIcon,
  HighlighterIcon,
  IndentIcon,
  ItalicIcon,
  KeyboardIcon,
  LinkIcon,
  ListCollapseIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  OutdentIcon,
  PaintBucketIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  UnderlineIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import {
  useEditorReadOnly,
  useEditorRef,
  useEditorSelector,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
} from "platejs/react";

import { formatKeys, withShortcut } from "@/lib/platform";
import { cn } from "@/lib/utils";

import { AlignToolbarButton } from "./align-toolbar-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { FontColorToolbarButton } from "./font-color-toolbar-button";
import { FontSizeToolbarButton } from "./font-size-toolbar-button";
import { RedoToolbarButton, UndoToolbarButton } from "./history-toolbar-button";
import {
  IndentToolbarButton,
  OutdentToolbarButton,
} from "./indent-toolbar-button";
import { InsertToolbarButton } from "./insert-toolbar-button";
import { LineHeightToolbarButton } from "./line-height-toolbar-button";
import { LinkToolbarButton } from "./link-toolbar-button";
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from "./list-toolbar-button";
import { MarkToolbarButton } from "./mark-toolbar-button";
import { MediaToolbarButton } from "./media-toolbar-button";
import { ModeToolbarButton } from "./mode-toolbar-button";
import { Separator } from "./separator";
import { TableToolbarButton } from "./table-toolbar-button";
import { ToggleToolbarButton } from "./toggle-toolbar-button";
import { ToolbarButton, ToolbarDropdown, ToolbarGroup } from "./toolbar";
import { TurnIntoToolbarButton } from "./turn-into-toolbar-button";

/** A ⋯ menu row for a toolbar button: same action, with a label and shortcut. */
function MenuRow({
  icon,
  keys,
  label,
  onClick,
  pressed,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  keys?: string;
  pressed?: boolean;
}) {
  return (
    <DropdownMenuItem
      className={cn(pressed && "bg-accent text-accent-foreground")}
      onSelect={onClick}
    >
      {icon}
      {label}
      {keys && (
        <DropdownMenuShortcut className="pl-6 tracking-normal">
          {formatKeys(keys).join("+")}
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}

function MarkMenuRow({
  clear,
  nodeType,
  ...props
}: Omit<React.ComponentProps<typeof MenuRow>, "onClick" | "pressed"> & {
  nodeType: string;
  clear?: string;
}) {
  const state = useMarkToolbarButtonState({ clear, nodeType });
  const { props: buttonProps } = useMarkToolbarButton(state);
  return <MenuRow {...props} {...buttonProps} />;
}

/** The marks that only live in the ⋯ menu. */
function ExtraMarkRows() {
  return (
    <>
      <MarkMenuRow
        nodeType={KEYS.kbd}
        icon={<KeyboardIcon />}
        label="Keyboard input"
      />
      <MarkMenuRow
        nodeType={KEYS.sup}
        clear={KEYS.sub}
        icon={<SuperscriptIcon />}
        label="Superscript"
        keys="mod+period"
      />
      <MarkMenuRow
        nodeType={KEYS.sub}
        clear={KEYS.sup}
        icon={<SubscriptIcon />}
        label="Subscript"
        keys="mod+comma"
      />
    </>
  );
}

function ListMenuRow({
  styleTypes,
  ...props
}: Omit<React.ComponentProps<typeof MenuRow>, "onClick" | "pressed"> & {
  styleTypes: ListStyleType[];
}) {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (editor) => someList(editor, styleTypes),
    [styleTypes],
  );
  return (
    <MenuRow
      {...props}
      pressed={pressed}
      onClick={() => toggleList(editor, { listStyleType: styleTypes[0] })}
    />
  );
}

const NUMBERED_STYLES = [
  ListStyleType.Decimal,
  ListStyleType.LowerAlpha,
  ListStyleType.UpperAlpha,
  ListStyleType.LowerRoman,
  ListStyleType.UpperRoman,
];
const BULLETED_STYLES = [
  ListStyleType.Disc,
  ListStyleType.Circle,
  ListStyleType.Square,
];

function TodoListMenuRow() {
  const state = useIndentTodoToolBarButtonState({ nodeType: "todo" });
  const { props } = useIndentTodoToolBarButton(state);
  return <MenuRow {...props} icon={<ListTodoIcon />} label="To-do list" />;
}

function ToggleListMenuRow() {
  const state = useToggleToolbarButtonState();
  const { props } = useToggleToolbarButton(state);
  return <MenuRow {...props} icon={<ListCollapseIcon />} label="Toggle list" />;
}

function LinkMenuRow() {
  const state = useLinkToolbarButtonState();
  const { props } = useLinkToolbarButton(state);
  return <MenuRow {...props} icon={<LinkIcon />} label="Link" />;
}

function OutdentMenuRow() {
  const { props } = useOutdentButton();
  return <MenuRow {...props} icon={<OutdentIcon />} label="Outdent" />;
}

function IndentMenuRow() {
  const { props } = useIndentButton();
  return <MenuRow {...props} icon={<IndentIcon />} label="Indent" />;
}

/**
 * The groups that make room when the toolbar is narrow, in order. The last
 * ones move into the ⋯ menu first, where `menu` stands in for `content`.
 */
const GROUPS: { key: string; content: React.ReactNode; menu: React.ReactNode }[] =
  [
    {
      key: "media",
      content: <MediaToolbarMenu />,
      menu: <MediaToolbarMenu submenu />,
    },
    {
      key: "blocks",
      content: (
        <>
          <InsertToolbarButton />
          <TurnIntoToolbarButton />
          <FontSizeToolbarButton />
        </>
      ),
      menu: (
        <>
          <InsertToolbarButton submenu />
          <TurnIntoToolbarButton submenu />
          {/* Not a menu item: the size field takes typing. */}
          <div
            className="flex items-center gap-2 py-0.5 pr-0.5 pl-2 text-ui [&>svg]:size-icon [&>svg]:text-muted-foreground"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ALargeSmallIcon />
            <span className="grow">Text size</span>
            <FontSizeToolbarButton />
          </div>
        </>
      ),
    },
    {
      key: "marks",
      content: (
        <>
          <MarkToolbarButton
            nodeType={KEYS.bold}
            tooltip={withShortcut("Bold", "mod+b")}
          >
            <BoldIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.italic}
            tooltip={withShortcut("Italic", "mod+i")}
          >
            <ItalicIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.underline}
            tooltip={withShortcut("Underline", "mod+u")}
          >
            <UnderlineIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.strikethrough}
            tooltip={withShortcut("Strikethrough", "mod+shift+x")}
          >
            <StrikethroughIcon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.code}
            tooltip={withShortcut("Code", "mod+e")}
          >
            <Code2Icon />
          </MarkToolbarButton>
          <MarkToolbarButton
            nodeType={KEYS.highlight}
            tooltip={withShortcut("Highlight", "mod+shift+h")}
          >
            <HighlighterIcon />
          </MarkToolbarButton>
          <FontColorToolbarButton nodeType={KEYS.color} tooltip="Text color">
            <BaselineIcon />
          </FontColorToolbarButton>
          <FontColorToolbarButton
            nodeType={KEYS.backgroundColor}
            tooltip="Background color"
          >
            <PaintBucketIcon />
          </FontColorToolbarButton>
        </>
      ),
      menu: (
        <>
          <MarkMenuRow
            nodeType={KEYS.bold}
            icon={<BoldIcon />}
            label="Bold"
            keys="mod+b"
          />
          <MarkMenuRow
            nodeType={KEYS.italic}
            icon={<ItalicIcon />}
            label="Italic"
            keys="mod+i"
          />
          <MarkMenuRow
            nodeType={KEYS.underline}
            icon={<UnderlineIcon />}
            label="Underline"
            keys="mod+u"
          />
          <MarkMenuRow
            nodeType={KEYS.strikethrough}
            icon={<StrikethroughIcon />}
            label="Strikethrough"
            keys="mod+shift+x"
          />
          <MarkMenuRow
            nodeType={KEYS.code}
            icon={<Code2Icon />}
            label="Code"
            keys="mod+e"
          />
          <ExtraMarkRows />
          <MarkMenuRow
            nodeType={KEYS.highlight}
            icon={<HighlighterIcon />}
            label="Highlight"
            keys="mod+shift+h"
          />
          <FontColorToolbarButton
            nodeType={KEYS.color}
            tooltip="Text color"
            submenu
          >
            <BaselineIcon />
          </FontColorToolbarButton>
          <FontColorToolbarButton
            nodeType={KEYS.backgroundColor}
            tooltip="Background color"
            submenu
          >
            <PaintBucketIcon />
          </FontColorToolbarButton>
        </>
      ),
    },
    {
      key: "lists",
      content: (
        <>
          <AlignToolbarButton />
          <NumberedListToolbarButton />
          <BulletedListToolbarButton />
          <TodoListToolbarButton />
          <ToggleToolbarButton />
        </>
      ),
      menu: (
        <>
          <AlignToolbarButton submenu />
          <ListMenuRow
            styleTypes={NUMBERED_STYLES}
            icon={<ListOrderedIcon />}
            label="Numbered list"
          />
          <ListMenuRow
            styleTypes={BULLETED_STYLES}
            icon={<ListIcon />}
            label="Bulleted list"
          />
          <TodoListMenuRow />
          <ToggleListMenuRow />
        </>
      ),
    },
    {
      key: "insert",
      content: (
        <>
          <LinkToolbarButton />
          <TableToolbarButton />
        </>
      ),
      menu: (
        <>
          <LinkMenuRow />
          <TableToolbarButton submenu />
        </>
      ),
    },
    {
      key: "spacing",
      content: (
        <>
          <LineHeightToolbarButton />
          <OutdentToolbarButton />
          <IndentToolbarButton />
        </>
      ),
      menu: (
        <>
          <LineHeightToolbarButton submenu />
          <OutdentMenuRow />
          <IndentMenuRow />
        </>
      ),
    },
  ];

export function FixedToolbarButtons() {
  const readOnly = useEditorReadOnly();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [shownCount, setShownCount] = React.useState(GROUPS.length);

  // The row wraps instead of scrolling; groups pushed onto a second line are
  // clipped and go into the ⋯ menu.
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const measure = () => {
      const groups = Array.from(row.children) as HTMLElement[];
      const top = groups[0]?.offsetTop ?? 0;
      const firstWrapped = groups.findIndex((group) => group.offsetTop > top);
      setShownCount(firstWrapped === -1 ? groups.length : firstWrapped);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const group of Array.from(row.children)) observer.observe(group);
    return () => observer.disconnect();
  }, [readOnly]);

  const hiddenGroups = GROUPS.slice(shownCount);

  return (
    <div className="flex h-full w-full min-w-0 items-center">
      {!readOnly && (
        <>
          <ToolbarGroup>
            <UndoToolbarButton />
            <RedoToolbarButton />
          </ToolbarGroup>

          <div ref={rowRef} className="flex h-9 min-w-0 flex-wrap overflow-hidden">
            {GROUPS.map((group, index) => (
              <div
                key={group.key}
                className="flex shrink-0"
                inert={index >= shownCount}
              >
                <div className="flex items-center">{group.content}</div>
                {/* Kept in place on the last shown group, so its width
                    doesn't change what fits. */}
                <div
                  className={cn(
                    "mx-1.5 py-0.5",
                    index >= shownCount - 1 && "invisible",
                  )}
                >
                  <Separator orientation="vertical" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grow" />

      {!readOnly && (
        <ToolbarGroup>
          <OverflowMenu groups={hiddenGroups} />
        </ToolbarGroup>
      )}

      <ToolbarGroup>
        <ModeToolbarButton />
      </ToolbarGroup>
    </div>
  );
}

/**
 * The groups that don't fit, in toolbar order. The marks without a button of
 * their own sit with the other marks, or first while those are on the toolbar.
 */
function OverflowMenu({
  groups,
}: {
  groups: { key: string; menu: React.ReactNode }[];
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const sections = groups.some((group) => group.key === "marks")
    ? groups
    : [{ key: "extra-marks", menu: <ExtraMarkRows /> }, ...groups];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild ref={triggerRef}>
        <ToolbarButton pressed={open} tooltip="More">
          <MoreHorizontalIcon />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="ignore-click-outside/toolbar min-w-56"
        onCloseAutoFocus={(e) => e.preventDefault()}
        // ⋯ itself opens and closes the menu, also while it fades out.
        onPointerDownOutside={(e) => {
          if (triggerRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        {sections.map((section, index) => (
          <React.Fragment key={section.key}>
            {index > 0 && <DropdownMenuSeparator />}
            {section.menu}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MediaToolbarMenu({ submenu }: { submenu?: boolean }) {
  const [open, setOpen] = React.useState(false);

  return (
    <ToolbarDropdown
      open={open}
      onOpenChange={setOpen}
      button={
        <ToolbarButton pressed={open} tooltip="Media and files" isDropdown>
          <FolderUpIcon />
        </ToolbarButton>
      }
      contentProps={{
        align: "start",
        className: "ignore-click-outside/toolbar",
      }}
      submenu={
        submenu
          ? { icon: <FolderUpIcon />, label: "Media and files" }
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-1 p-1">
        <MediaToolbarButton nodeType={KEYS.img} />
        <MediaToolbarButton nodeType={KEYS.video} />
        <MediaToolbarButton nodeType={KEYS.audio} />
        <MediaToolbarButton nodeType={KEYS.file} />
      </div>
    </ToolbarDropdown>
  );
}
