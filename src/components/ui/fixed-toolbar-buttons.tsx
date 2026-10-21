"use client";

import * as React from "react";

import {
  BaselineIcon,
  BoldIcon,
  Code2Icon,
  FolderUpIcon,
  HighlighterIcon,
  ItalicIcon,
  KeyboardIcon,
  MoreHorizontalIcon,
  PaintBucketIcon,
  StrikethroughIcon,
  SubscriptIcon,
  SuperscriptIcon,
  UnderlineIcon,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorReadOnly } from "platejs/react";

import { withShortcut } from "@/lib/platform";
import { cn } from "@/lib/utils";

import { AlignToolbarButton } from "./align-toolbar-button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Separator } from "./separator";
import { TableToolbarButton } from "./table-toolbar-button";
import { ToggleToolbarButton } from "./toggle-toolbar-button";
import { Toolbar, ToolbarButton, ToolbarGroup } from "./toolbar";
import { TurnIntoToolbarButton } from "./turn-into-toolbar-button";

/**
 * The groups that make room when the toolbar is narrow, in order. The last
 * ones move into the ⋯ menu first.
 */
const GROUPS: { key: string; content: React.ReactNode }[] = [
  { key: "media", content: <MediaToolbarMenu /> },
  {
    key: "blocks",
    content: (
      <>
        <InsertToolbarButton />
        <TurnIntoToolbarButton />
        <FontSizeToolbarButton />
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
  },
  {
    key: "insert",
    content: (
      <>
        <LinkToolbarButton />
        <TableToolbarButton />
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
 * Groups that don't fit, then the marks that have no button of their own.
 */
function OverflowMenu({
  groups,
}: {
  groups: { key: string; content: React.ReactNode }[];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <ToolbarButton pressed={open} tooltip="More">
          <MoreHorizontalIcon />
        </ToolbarButton>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="ignore-click-outside/toolbar w-auto max-w-[calc(100vw-2rem)] gap-0 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Toolbar className="flex-col items-stretch">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-wrap items-center">
              {group.content}
            </div>
          ))}
          {groups.length > 0 && <Separator className="my-1" />}
          <div className="flex items-center">
            <MarkToolbarButton nodeType={KEYS.kbd} tooltip="Keyboard input">
              <KeyboardIcon />
            </MarkToolbarButton>
            <MarkToolbarButton
              nodeType={KEYS.sup}
              clear={KEYS.sub}
              tooltip={withShortcut("Superscript", "mod+period")}
            >
              <SuperscriptIcon />
            </MarkToolbarButton>
            <MarkToolbarButton
              nodeType={KEYS.sub}
              clear={KEYS.sup}
              tooltip={withShortcut("Subscript", "mod+comma")}
            >
              <SubscriptIcon />
            </MarkToolbarButton>
          </div>
        </Toolbar>
      </PopoverContent>
    </Popover>
  );
}

function MediaToolbarMenu() {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton pressed={open} tooltip="Media and files" isDropdown>
          <FolderUpIcon />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="ignore-click-outside/toolbar"
      >
        <div className="grid grid-cols-2 gap-1 p-1">
          <MediaToolbarButton nodeType={KEYS.img} />
          <MediaToolbarButton nodeType={KEYS.video} />
          <MediaToolbarButton nodeType={KEYS.audio} />
          <MediaToolbarButton nodeType={KEYS.file} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
