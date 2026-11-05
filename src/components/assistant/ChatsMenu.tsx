import { useState } from "react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openChat, removeAllChats, removeChat } from "@/lib/assistant";
import { type ChatInfo, listChats } from "@/lib/commands";
import { isSamePath } from "@/lib/drawing-files";
import { formatDay, formatShortDay, formatTime } from "@/lib/history";
import { useVaultStore } from "@/store/vault";

/** Asks before every saved chat is deleted. */
export function DeleteAllChatsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
          <AlertDialogDescription>
            Chats are only on this computer, so they can't be brought back.
            Your shards stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              void removeAllChats().catch(() =>
                toast.error("Couldn't delete the chats"),
              )
            }
          >
            Delete all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The panel's title, which lists this vault's chats to switch to. */
export function ChatsMenu({ title }: { title: string }) {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () =>
    listChats().then(
      (all) =>
        setChats(
          all.filter((chat) => vault !== null && isSamePath(chat.vault, vault)),
        ),
      () => setChats([]),
    );

  const seconds = (chat: ChatInfo) => Math.floor(chat.updated / 1000);
  const today = chats.filter((c) => formatDay(seconds(c)) === "Today");
  const earlier = chats.filter((c) => formatDay(seconds(c)) !== "Today");

  const row = (chat: ChatInfo, time: string) => (
    <DropdownMenuItem
      key={chat.id}
      className="group gap-2 pr-1"
      onSelect={() =>
        void openChat(chat.id).catch(() => toast.error("Couldn't open the chat"))
      }
    >
      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      <span className="shrink-0 text-muted-foreground text-ui-sm group-focus:hidden group-hover:hidden">
        {time}
      </span>
      <button
        type="button"
        aria-label={`Delete ${chat.title}`}
        className="hidden size-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground hover:text-foreground group-focus:inline-flex group-hover:inline-flex"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void removeChat(chat.id).then(
            () => setChats((current) => current.filter((c) => c.id !== chat.id)),
            () => toast.error("Couldn't delete the chat"),
          );
        }}
      >
        <Trash2Icon className="size-4" />
      </button>
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chats"
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md p-1 text-left font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-accent"
          >
            <span className="truncate">{title}</span>
            <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {chats.length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground text-ui">
              No saved chats
            </div>
          ) : null}
          {today.length > 0 ? (
            <>
              <DropdownMenuLabel className="font-normal text-muted-foreground text-ui-sm">
                Today
              </DropdownMenuLabel>
              {today.map((chat) => row(chat, formatTime(seconds(chat))))}
            </>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <DropdownMenuLabel className="font-normal text-muted-foreground text-ui-sm">
                Earlier
              </DropdownMenuLabel>
              {earlier.map((chat) => row(chat, formatShortDay(seconds(chat))))}
            </>
          ) : null}
          {chats.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirming(true)}
              >
                <Trash2Icon />
                Delete all chats
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteAllChatsDialog open={confirming} onOpenChange={setConfirming} />
    </>
  );
}
