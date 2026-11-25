import { useEffect, type ReactNode } from "react";
import {
  FileTextIcon,
  FolderIcon,
  HistoryIcon,
  RotateCcwIcon,
  Trash2Icon,
  TrashIcon,
} from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BottomSheet, BottomSheetItem } from "@/components/ui/bottom-sheet";
import { Dot } from "@/components/ui/dot";
import type { TrashedItem } from "@/lib/commands/trash";
import { getVaultFileDisplayName, isDrawingPath } from "@/lib/drawing-files";
import { formatBytes } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { closer, useLast, usePhoneNav, useSelecting } from "./nav";
import {
  PhoneBackButton,
  PhoneFrame,
  PhoneSection,
  PhoneTitle,
  PhoneTopBar,
} from "./parts";
import { SelectBox } from "./rows";
import { BarButton, SelectTopBar } from "./SelectBars";
import { usePhoneSelection } from "./selection";
import {
  deletedLabel,
  deleteTrashedForever,
  dismissMovedToTrash,
  folderOf,
  restoreTrashed,
  useAppTrash,
} from "./trash";

function itemName(item: TrashedItem) {
  if (item.historyOf !== null) return `History of ${item.historyOf}`;
  return item.isFolder ? item.name : getVaultFileDisplayName(item.name);
}

/** Where it was: its folder in the vault, or for a history, what it is. */
function itemPlace(item: TrashedItem, vault: string) {
  return item.historyOf !== null
    ? "A vault that's gone"
    : folderOf(item.from, vault);
}

function ItemIcon({ item }: { item: TrashedItem }) {
  const Icon =
    item.historyOf !== null
      ? HistoryIcon
      : item.isFolder
        ? FolderIcon
        : isDrawingPath(item.name)
          ? DrawingIcon
          : FileTextIcon;
  return <Icon className="size-5 shrink-0 text-muted-foreground" />;
}

/** "this shard", "this drawing", "this folder" or "3 items". */
function whatLabel(items: TrashedItem[]) {
  if (items.length !== 1) return itemsLabel(items.length);
  const [item] = items;
  if (item.historyOf !== null) return "this history";
  if (item.isFolder) return "this folder";
  return isDrawingPath(item.name) ? "this drawing" : "this shard";
}

function itemsLabel(count: number) {
  return count === 1 ? "1 item" : `${count} items`;
}

/** Leaves select mode once its action is done. */
function stopSelecting() {
  usePhoneNav.getState().closeFrom("select");
}

/**
 * What was deleted from the open vault, and the histories of vaults that
 * are gone: tap an item to restore it or delete it for good, select several
 * to do that together, or empty the whole trash.
 */
export function TrashScreen() {
  const items = useAppTrash((s) => s.items);
  const loaded = useAppTrash((s) => s.loaded);
  const vault = useVaultStore((s) => s.currentVaultPath) ?? "";
  const push = usePhoneNav((s) => s.push);
  const selecting = useSelecting();
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const vaultItems = items.filter((item) => item.historyOf === null);
  const histories = items.filter((item) => item.historyOf !== null);

  useEffect(() => {
    void useAppTrash.getState().load();
  }, [vault]);

  // Restore is here now, and the toast would cover Empty Trash.
  useEffect(() => dismissMovedToTrash(), []);

  const rows = (shown: TrashedItem[]) => (
    <ul>
      {shown.map((item) => (
        <li key={item.id}>
          <TrashRow item={item} vault={vault} />
        </li>
      ))}
    </ul>
  );

  return (
    <PhoneFrame bottomInset={items.length === 0}>
      {selecting ? (
        <SelectTopBar shown={items.map((item) => item.id)} />
      ) : (
        <PhoneTopBar>
          <PhoneBackButton />
          <PhoneTitle>Trash</PhoneTitle>
          {items.length > 0 ? (
            <button
              type="button"
              className="h-12 shrink-0 rounded-full px-3 font-medium outline-none active:bg-accent"
              onClick={() => push({ kind: "select" })}
            >
              Select
            </button>
          ) : null}
        </PhoneTopBar>
      )}
      {loaded && items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-8 pt-30 text-center">
          <TrashIcon className="size-8 text-muted-foreground" />
          <p className="text-lg font-semibold">Trash is empty</p>
        </div>
      ) : (
        <>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            aria-label="Deleted items"
            role="region"
          >
            {items.length > 0 ? (
              <p className="flex items-center gap-2 px-4 pt-2 pb-2.5 text-sm leading-5 font-medium text-muted-foreground">
                {itemsLabel(items.length)}
                <Dot className="mx-0" />
                {formatBytes(bytes)}
              </p>
            ) : null}
            {rows(vaultItems)}
            {histories.length > 0 ? (
              <PhoneSection label="Sync history of gone vaults">
                {rows(histories)}
              </PhoneSection>
            ) : null}
          </div>
          {selecting ? (
            <TrashSelectBar />
          ) : items.length > 0 ? (
            <div className="shrink-0 border-t bg-sidebar pb-safe-bottom">
              <div className="flex px-4 py-3">
                <button
                  type="button"
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] border border-input font-medium outline-none active:bg-accent [&_svg]:size-5"
                  onClick={() => push({ kind: "confirm-empty-trash" })}
                >
                  <Trash2Icon />
                  Empty Trash
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      <TrashItemSheet items={items} />
      <DeleteForeverDialog items={items} />
      <EmptyTrashDialog items={items} />
    </PhoneFrame>
  );
}

/** One deleted item: opens its menu, or while selecting, picks it. */
function TrashRow({ item, vault }: { item: TrashedItem; vault: string }) {
  const push = usePhoneNav((s) => s.push);
  const selecting = useSelecting();
  const checked = usePhoneSelection((s) => s.paths.includes(item.id));
  const toggle = usePhoneSelection((s) => s.toggle);
  return (
    <button
      type="button"
      role={selecting ? "checkbox" : undefined}
      aria-checked={selecting ? checked : undefined}
      className={cn(
        "flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 text-left outline-none select-none active:bg-accent",
        selecting && checked && "bg-card",
      )}
      onClick={() =>
        selecting ? toggle(item.id) : push({ kind: "trash-item", id: item.id })
      }
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        {selecting ? <SelectBox checked={checked} /> : <ItemIcon item={item} />}
        <span className="min-w-0 flex-1 truncate font-medium">
          {itemName(item)}
        </span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-2 pl-8 text-sm leading-5 text-muted-foreground">
        <span className="min-w-0 truncate">{itemPlace(item, vault)}</span>
        <Dot className="mx-0" />
        <span className="shrink-0">{deletedLabel(item.deletedAt)}</span>
      </span>
    </button>
  );
}

/** The bottom bar while selecting: Restore and Delete forever. */
function TrashSelectBar() {
  const ids = usePhoneSelection((s) => s.paths);
  const push = usePhoneNav((s) => s.push);
  const none = ids.length === 0;
  return (
    <div className="shrink-0 border-t bg-sidebar pb-safe-bottom">
      <div className="flex h-20 items-center justify-around">
        <BarButton
          label="Restore"
          icon={<RotateCcwIcon />}
          disabled={none}
          onClick={() => {
            void restoreTrashed(ids);
            stopSelecting();
          }}
        />
        <BarButton
          label="Delete forever"
          icon={<Trash2Icon />}
          disabled={none}
          onClick={() => push({ kind: "confirm-delete-forever", ids })}
        />
      </div>
    </div>
  );
}

/** One item's menu: Restore, or Delete forever after a question. */
function TrashItemSheet({ items }: { items: TrashedItem[] }) {
  const menu = useLast("trash-item");
  const replace = usePhoneNav((s) => s.replace);
  const item = items.find((entry) => entry.id === menu.overlay?.id);
  if (!item) return null;

  const restore = () => {
    closer("trash-item")(false);
    void restoreTrashed([item.id]);
  };

  return (
    <BottomSheet
      open={menu.open}
      onOpenChange={closer("trash-item")}
      title={itemName(item)}
    >
      <BottomSheetItem icon={<RotateCcwIcon />} onClick={restore}>
        Restore
      </BottomSheetItem>
      <BottomSheetItem
        danger
        icon={<Trash2Icon />}
        onClick={() =>
          replace({ kind: "confirm-delete-forever", ids: [item.id] })
        }
      >
        Delete forever
      </BottomSheetItem>
    </BottomSheet>
  );
}

function ConfirmDialog({
  kind,
  title,
  description,
  action,
  onConfirm,
}: {
  kind: "confirm-delete-forever" | "confirm-empty-trash";
  title: ReactNode;
  description: ReactNode;
  action: string;
  onConfirm: () => void;
}) {
  const confirm = useLast(kind);
  return (
    <AlertDialog open={confirm.open} onOpenChange={closer(kind)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteForeverDialog({ items }: { items: TrashedItem[] }) {
  const confirm = useLast("confirm-delete-forever");
  const ids = confirm.overlay?.ids ?? [];
  const picked = items.filter((item) => ids.includes(item.id));
  const what = whatLabel(picked);
  return (
    <ConfirmDialog
      kind="confirm-delete-forever"
      title={`Delete ${what} forever?`}
      description="You can't undo this."
      action="Delete"
      onConfirm={() => {
        void deleteTrashedForever(ids);
        // Picked in select mode: done with picking too.
        stopSelecting();
      }}
    />
  );
}

function EmptyTrashDialog({ items }: { items: TrashedItem[] }) {
  return (
    <ConfirmDialog
      kind="confirm-empty-trash"
      title="Empty Trash?"
      description={`${itemsLabel(items.length)} will be deleted forever. You can't undo this.`}
      action="Empty Trash"
      onConfirm={() => void deleteTrashedForever(items.map((item) => item.id))}
    />
  );
}
