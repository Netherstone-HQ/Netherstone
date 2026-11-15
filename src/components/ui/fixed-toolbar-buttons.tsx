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

import { useShortcutKeys } from "@/hooks/useShortcut";
import { keysText } from "@/lib/platform";
import type { ShortcutId } from "@/lib/shortcuts";
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
  shortcut,
  label,
  onClick,
  pressed,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: ShortcutId;
  pressed?: boolean;
}) {
  const keys = useShortcutKeys(shortcut);
  return (
    <DropdownMenuItem
      className={cn(pressed && "bg-accent text-accent-foreground")}
      onSelect={onClick}
    >
      {icon}
      {label}
      {keys && (
        <DropdownMenuShortcut className="pl-6 tracking-normal">
          {keysText(keys)}
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
        shortcut="superscript"
      />
      <MarkMenuRow
        nodeType={KEYS.sub}
        clear={KEYS.sup}
        icon={<SubscriptIcon />}
        label="Subscript"
        shortcut="subscript"
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

/** A toolbar button and the ⋯ menu row that stands in for it. */
type Item = { key: string; content: React.ReactNode; menu: React.ReactNode };

/** A run of items with a separator after it. */
type Group = { key: string; items: Item[] };

function markItem(
  key: string,
  nodeType: string,
  label: string,
  icon: React.ReactNode,
  shortcut: ShortcutId,
): Item {
  return {
    key,
    content: (
      <MarkToolbarButton
        nodeType={nodeType}
        tooltip={label}
        shortcut={shortcut}
      >
        {icon}
      </MarkToolbarButton>
    ),
    menu: (
      <MarkMenuRow
        nodeType={nodeType}
        icon={icon}
        label={label}
        shortcut={shortcut}
      />
    ),
  };
}

function colorItem(
  key: string,
  nodeType: string,
  label: string,
  icon: React.ReactNode,
): Item {
  return {
    key,
    content: (
      <FontColorToolbarButton nodeType={nodeType} tooltip={label}>
        {icon}
      </FontColorToolbarButton>
    ),
    menu: (
      <FontColorToolbarButton nodeType={nodeType} tooltip={label} submenu>
        {icon}
      </FontColorToolbarButton>
    ),
  };
}

/** The item whose menu row the marks without a button of their own follow. */
const EXTRA_MARKS_AFTER = "code";

function withExtraMarks(item: Item): Item {
  return {
    ...item,
    menu: (
      <>
        {item.menu}
        <ExtraMarkRows />
      </>
    ),
  };
}

/**
 * The buttons that make room when the toolbar is narrow, in order. The last
 * ones move into the ⋯ menu first, one at a time.
 */
const GROUPS: Group[] = [
  {
    key: "media",
    items: [
      {
        key: "media",
        content: <MediaToolbarMenu />,
        menu: <MediaToolbarMenu submenu />,
      },
    ],
  },
  {
    key: "blocks",
    items: [
      {
        key: "insert",
        content: <InsertToolbarButton />,
        menu: <InsertToolbarButton submenu />,
      },
      {
        key: "turn-into",
        content: <TurnIntoToolbarButton />,
        menu: <TurnIntoToolbarButton submenu />,
      },
      {
        key: "font-size",
        content: <FontSizeToolbarButton />,
        menu: (
          // Not a menu item: the size field takes typing.
          <div
            className="flex items-center gap-2 py-0.5 pr-0.5 pl-2 text-ui [&>svg]:size-icon [&>svg]:text-muted-foreground"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <ALargeSmallIcon />
            <span className="grow">Text size</span>
            <FontSizeToolbarButton />
          </div>
        ),
      },
    ],
  },
  {
    key: "marks",
    items: [
      markItem("bold", KEYS.bold, "Bold", <BoldIcon />, "bold"),
      markItem("italic", KEYS.italic, "Italic", <ItalicIcon />, "italic"),
      markItem(
        "underline",
        KEYS.underline,
        "Underline",
        <UnderlineIcon />,
        "underline",
      ),
      markItem(
        "strikethrough",
        KEYS.strikethrough,
        "Strikethrough",
        <StrikethroughIcon />,
        "strikethrough",
      ),
      withExtraMarks(
        markItem(EXTRA_MARKS_AFTER, KEYS.code, "Code", <Code2Icon />, "code"),
      ),
      markItem(
        "highlight",
        KEYS.highlight,
        "Highlight",
        <HighlighterIcon />,
        "highlight",
      ),
      colorItem("color", KEYS.color, "Text color", <BaselineIcon />),
      colorItem(
        "background",
        KEYS.backgroundColor,
        "Background color",
        <PaintBucketIcon />,
      ),
    ],
  },
  {
    key: "lists",
    items: [
      {
        key: "align",
        content: <AlignToolbarButton />,
        menu: <AlignToolbarButton submenu />,
      },
      {
        key: "numbered",
        content: <NumberedListToolbarButton />,
        menu: (
          <ListMenuRow
            styleTypes={NUMBERED_STYLES}
            icon={<ListOrderedIcon />}
            label="Numbered list"
          />
        ),
      },
      {
        key: "bulleted",
        content: <BulletedListToolbarButton />,
        menu: (
          <ListMenuRow
            styleTypes={BULLETED_STYLES}
            icon={<ListIcon />}
            label="Bulleted list"
          />
        ),
      },
      {
        key: "todo",
        content: <TodoListToolbarButton />,
        menu: <TodoListMenuRow />,
      },
      {
        key: "toggle",
        content: <ToggleToolbarButton />,
        menu: <ToggleListMenuRow />,
      },
    ],
  },
  {
    key: "insert",
    items: [
      { key: "link", content: <LinkToolbarButton />, menu: <LinkMenuRow /> },
      {
        key: "table",
        content: <TableToolbarButton />,
        menu: <TableToolbarButton submenu />,
      },
    ],
  },
  {
    key: "spacing",
    items: [
      {
        key: "line-height",
        content: <LineHeightToolbarButton />,
        menu: <LineHeightToolbarButton submenu />,
      },
      {
        key: "outdent",
        content: <OutdentToolbarButton />,
        menu: <OutdentMenuRow />,
      },
      {
        key: "indent",
        content: <IndentToolbarButton />,
        menu: <IndentMenuRow />,
      },
    ],
  },
];

/** Every item in toolbar order, with whether it ends its group. */
const ITEMS = GROUPS.flatMap((group) =>
  group.items.map((item, index) => ({
    ...item,
    group: group.key,
    endsGroup: index === group.items.length - 1,
  })),
);

export function FixedToolbarButtons() {
  const readOnly = useEditorReadOnly();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [shownCount, setShownCount] = React.useState(ITEMS.length);

  // The row wraps instead of scrolling; buttons pushed onto a second line are
  // clipped and go into the ⋯ menu. Measured only when the observer first
  // fires, after layout, so a shard switch doesn't force a layout here.
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const measure = () => {
      const items = Array.from(row.children) as HTMLElement[];
      const top = items[0]?.offsetTop ?? 0;
      const firstWrapped = items.findIndex((item) => item.offsetTop > top);
      setShownCount(firstWrapped === -1 ? items.length : firstWrapped);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const item of Array.from(row.children)) observer.observe(item);
    return () => observer.disconnect();
  }, [readOnly]);

  return (
    <div className="flex h-full w-full min-w-0 items-center">
      {!readOnly && (
        <>
          <ToolbarGroup>
            <UndoToolbarButton />
            <RedoToolbarButton />
          </ToolbarGroup>

          <div ref={rowRef} className="flex h-9 min-w-0 flex-wrap overflow-hidden">
            {ITEMS.map((item, index) => (
              <div
                key={item.key}
                className="flex shrink-0 items-center"
                inert={index >= shownCount}
              >
                {item.content}
                {/* Kept in place on the last shown button, so its width
                    doesn't change what fits. */}
                {item.endsGroup && (
                  <div
                    className={cn(
                      "mx-1.5 py-0.5",
                      index >= shownCount - 1 && "invisible",
                    )}
                  >
                    <Separator orientation="vertical" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="grow" />

      {!readOnly && (
        <ToolbarGroup>
          <OverflowMenu items={ITEMS.slice(shownCount)} />
        </ToolbarGroup>
      )}

      <ToolbarGroup>
        <ModeToolbarButton />
      </ToolbarGroup>
    </div>
  );
}

/**
 * The buttons that don't fit, in toolbar order, a section per group. The marks
 * without a button of their own follow Code, or come first while it's on the
 * toolbar.
 */
function OverflowMenu({
  items,
}: {
  items: { key: string; group: string; menu: React.ReactNode }[];
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const sections: { key: string; rows: React.ReactNode[] }[] = [];
  if (!items.some((item) => item.key === EXTRA_MARKS_AFTER)) {
    sections.push({
      key: "extra-marks",
      rows: [<ExtraMarkRows key="extra" />],
    });
  }
  for (const item of items) {
    const row = <React.Fragment key={item.key}>{item.menu}</React.Fragment>;
    const last = sections.at(-1);
    if (last?.key === item.group) last.rows.push(row);
    else sections.push({ key: item.group, rows: [row] });
  }

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
        collisionPadding={8}
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
            {section.rows}
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
