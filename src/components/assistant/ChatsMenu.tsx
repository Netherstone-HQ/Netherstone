import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, HistoryIcon, TrashIcon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useAssistantStore } from "@/store/assistant";
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

/**
 * This vault's chats to switch to, from the panel's title in a chat or from
 * the Chats button in a new one. The button is there once a chat is saved.
 */
export function ChatsMenu({ title }: { title: string | null }) {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const chatId = useAssistantStore((s) => s.chat?.id ?? null);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    () =>
      listChats().then(
        (all) =>
          setChats(
            all.filter((chat) => vault !== null && isSamePath(chat.vault, vault)),
          ),
        () => setChats([]),
      ),
    [vault],
  );

  // Starting or leaving a chat can add or remove one.
  useEffect(() => {
    void load();
  }, [load, chatId]);

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
        <TrashIcon className="size-4" />
      </button>
    </DropdownMenuItem>
  );

  if (title === null && chats.length === 0) return null;

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void load();
        }}
      >
        {title === null ? (
          <Hint label="Chats" side="bottom">
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Chats"
                className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent"
              >
                <HistoryIcon />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
        ) : (
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
        )}
        <DropdownMenuContent align={title === null ? "end" : "start"} className="w-80">
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
                <TrashIcon />
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
