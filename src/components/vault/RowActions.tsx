import { Fragment } from "react";
import { EllipsisVerticalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACTION_SLOT_PX } from "@/components/vault/tree-layout";
import { useMenuAction } from "@/lib/use-menu-action";

export type RowAction = {
  label: string;
  icon: React.ComponentType;
  onSelect: () => void;
  destructive?: boolean;
  /** Starts a new group in the menu. */
  separated?: boolean;
};

/** Each action runs once the menu has closed (see `useMenuAction`). */
function renderRowActions(
  actions: RowAction[],
  defer: (action: () => void) => () => void,
  Item: typeof DropdownMenuItem | typeof ContextMenuItem,
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
) {
  return actions.map(
    ({ label, icon: Icon, onSelect, destructive, separated }) => (
      <Fragment key={label}>
        {separated ? <Separator /> : null}
        <Item
          onSelect={defer(onSelect)}
          variant={destructive ? "destructive" : "default"}
        >
          <Icon />
          {label}
        </Item>
      </Fragment>
    ),
  );
}

/** `actions` in a menu that `children`, its trigger, opens. */
export function ActionsMenu({
  actions,
  align = "end",
  children,
}: {
  actions: RowAction[];
  align?: "start" | "end";
  children: React.ReactElement;
}) {
  const menuAction = useMenuAction();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={menuAction.onCloseAutoFocus}
      >
        {renderRowActions(
          actions,
          menuAction.defer,
          DropdownMenuItem,
          DropdownMenuSeparator,
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A row's "more" (⋮) button, shown while the row (a `group/row`) is hovered
 * or focused, or its menu is open.
 */
export function RowActionsButton({
  label,
  actions,
}: {
  /** Names the row, for screen readers: "Actions for {label}". */
  label: string;
  actions: RowAction[];
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-end opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-aria-expanded:opacity-100"
      style={{ width: `${ACTION_SLOT_PX}px` }}
    >
      <ActionsMenu actions={actions}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Actions for ${label}`}
          className="rounded-sm text-muted-foreground hover:bg-transparent hover:text-sidebar-foreground focus-visible:border-transparent focus-visible:ring-0 aria-expanded:bg-transparent aria-expanded:text-sidebar-foreground dark:hover:bg-transparent"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <EllipsisVerticalIcon className="size-icon" />
        </Button>
      </ActionsMenu>
    </div>
  );
}

/** The same actions on right-click anywhere on the row. */
export function RowContextMenu({
  actions,
  disabled,
  children,
}: {
  actions: RowAction[];
  disabled?: boolean;
  children: React.ReactElement;
}) {
  const menuAction = useMenuAction();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={menuAction.onCloseAutoFocus}
      >
        {renderRowActions(
          actions,
          menuAction.defer,
          ContextMenuItem,
          ContextMenuSeparator,
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
