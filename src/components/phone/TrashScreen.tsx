import { useEffect } from "react";
import {
  FileTextIcon,
  FolderIcon,
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
import { useVaultStore } from "@/store";
import { closer, useLast, usePhoneNav } from "./nav";
import { PhoneBackButton, PhoneFrame, PhoneTitle, PhoneTopBar } from "./parts";
import {
  deletedLabel,
  deleteTrashedForever,
  dismissMovedToTrash,
  folderOf,
  restoreTrashed,
  useAppTrash,
} from "./trash";

function itemName(item: TrashedItem) {
  return item.isFolder ? item.name : getVaultFileDisplayName(item.name);
}

function ItemIcon({ item }: { item: TrashedItem }) {
  const Icon = item.isFolder
    ? FolderIcon
    : isDrawingPath(item.name)
      ? DrawingIcon
      : FileTextIcon;
  return <Icon className="size-5 shrink-0 text-muted-foreground" />;
}

/** "shard", "drawing" or "folder", for the Delete forever question. */
function kindWord(item: TrashedItem) {
  if (item.isFolder) return "folder";
  return isDrawingPath(item.name) ? "drawing" : "shard";
}

function itemsLabel(count: number) {
  return count === 1 ? "1 item" : `${count} items`;
}

/**
 * What was deleted from the open vault: tap an item to restore it or
 * delete it for good, or empty the whole trash.
 */
export function TrashScreen() {
  const items = useAppTrash((s) => s.items);
  const loaded = useAppTrash((s) => s.loaded);
  const vault = useVaultStore((s) => s.currentVaultPath) ?? "";
  const push = usePhoneNav((s) => s.push);
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);

  useEffect(() => {
    void useAppTrash.getState().load();
  }, [vault]);

  // Restore is here now, and the toast would cover Empty Trash.
  useEffect(() => dismissMovedToTrash(), []);

  return (
    <PhoneFrame bottomInset={items.length === 0}>
      <PhoneTopBar>
        <PhoneBackButton />
        <PhoneTitle>Trash</PhoneTitle>
      </PhoneTopBar>
      {loaded && items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-8 pt-30 text-center">
          <TrashIcon className="size-8 text-muted-foreground" />
          <p className="text-lg font-semibold">Trash is empty</p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {items.length > 0 ? (
              <p className="flex items-center gap-2 px-4 pt-2 pb-2.5 text-sm leading-5 font-medium text-muted-foreground">
                {itemsLabel(items.length)}
                <Dot className="mx-0" />
                {formatBytes(bytes)}
              </p>
            ) : null}
            <ul aria-label="Deleted items">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 text-left outline-none select-none active:bg-accent"
                    onClick={() => push({ kind: "trash-item", id: item.id })}
                  >
                    <span className="flex w-full min-w-0 items-center gap-3">
                      <ItemIcon item={item} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {itemName(item)}
                      </span>
                    </span>
                    <span className="flex w-full min-w-0 items-center gap-2 pl-8 text-sm leading-5 text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {folderOf(item.from, vault)}
                      </span>
                      <Dot className="mx-0" />
                      <span className="shrink-0">
                        {deletedLabel(item.deletedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {items.length > 0 ? (
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
        onClick={() => replace({ kind: "confirm-delete-forever", id: item.id })}
      >
        Delete forever
      </BottomSheetItem>
    </BottomSheet>
  );
}

function DeleteForeverDialog({ items }: { items: TrashedItem[] }) {
  const confirm = useLast("confirm-delete-forever");
  const item = items.find((entry) => entry.id === confirm.overlay?.id);
  const close = closer("confirm-delete-forever");
  return (
    <AlertDialog open={confirm.open && !!item} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete this {item ? kindWord(item) : "item"} forever?
          </AlertDialogTitle>
          <AlertDialogDescription>You can't undo this.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (item) void deleteTrashedForever([item.id]);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyTrashDialog({ items }: { items: TrashedItem[] }) {
  const confirm = useLast("confirm-empty-trash");
  const close = closer("confirm-empty-trash");
  return (
    <AlertDialog open={confirm.open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            {itemsLabel(items.length)} will be deleted forever. You can't undo
            this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              void deleteTrashedForever(items.map((item) => item.id))
            }
          >
            Empty Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
