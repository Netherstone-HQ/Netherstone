import { useEffect, useRef, useState } from "react";
import {
  CpuIcon,
  FolderIcon,
  KeyRoundIcon,
  Link2Icon,
  NewspaperIcon,
  ServerOffIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import {
  closeAssistant,
  newChat,
  retryAnswer,
  sendMessage,
  stopAnswer,
} from "@/lib/assistant";
import { openShardPath } from "@/lib/assistant-changes";
import { setMcpVaultAllowed } from "@/lib/commands/mcp";
import { folderName } from "@/lib/open-vault";
import { useAssistantStore } from "@/store/assistant";
import { useCompanionStore } from "@/store/companion";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

import { ChatsMenu } from "./ChatsMenu";
import { ModelButton } from "./ModelButton";
import { Composer } from "./Composer";
import { serverDownText, setupState, useSetup } from "./setup";
import { Messages } from "./panel/Messages";

/**
 * What's missing before the next message can go, under a chat that's
 * there: the chat stays readable.
 */
function Notice({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action: React.ReactNode;
}) {
  return (
    // The buttons wrap under the text when the panel is too narrow for both.
    <div className="mx-2 mb-2 flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5 rounded-lg border bg-card py-1.5 pr-1.5 pl-3">
      <div className="flex min-w-48 flex-1 items-center gap-2.5">
        <span className="flex shrink-0 text-muted-foreground">{icon}</span>
        <p className="min-w-0 flex-1 text-muted-foreground">{text}</p>
      </div>
      {action}
    </div>
  );
}

function Center({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-12 text-center">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/** The composer card is where the companion sits while the panel is open. */
const setPerch = (perch: HTMLDivElement | null) =>
  useCompanionStore.setState({ perch });

function Starters({ onAsk }: { onAsk: (text: string) => void }) {
  const starter =
    "flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-left hover:bg-accent";
  return (
    <div className="flex flex-1 flex-col gap-2 p-4">
      <button
        type="button"
        className={starter}
        onClick={() => onAsk("Summarize this shard")}
      >
        <NewspaperIcon className="size-4 text-muted-foreground" />
        Summarize this shard
      </button>
      <button
        type="button"
        className={starter}
        onClick={() => onAsk("Find related shards")}
      >
        <Link2Icon className="size-4 text-muted-foreground" />
        Find related shards
      </button>
    </div>
  );
}

/** The assistant, in the right sidebar's place: one chat at a time. */
export function AssistantPanel() {
  const { setup, reload } = useSetup();
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const openSettings = useUIStore((s) => s.openSettings);
  const chat = useAssistantStore((s) => s.chat);
  const messages = useAssistantStore((s) => s.messages);
  const answering = useAssistantStore((s) => s.answering !== null);
  const draft = useAssistantStore((s) => s.draft);
  const added = useAssistantStore((s) => s.added);
  const openShardRemoved = useAssistantStore((s) => s.openShardRemoved);
  const { setDraft, setAdded, setOpenShardRemoved } =
    useAssistantStore.getState();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Another shard opened: it goes with the next message again.
  const lastOpen = useRef(openPath);
  useEffect(() => {
    if (lastOpen.current === openPath) return;
    lastOpen.current = openPath;
    setOpenShardRemoved(false);
  }, [openPath, setOpenShardRemoved]);

  const openShard = openShardPath(vault, openPath);
  const shards = [
    ...(openShard && !openShardRemoved ? [openShard] : []),
    ...added.filter((path) => path !== openShard),
  ];

  const state = setupState(setup);
  const ready = state === "ready";

  const send = (text: string, with_: string[]) => {
    if (!ready || !text.trim()) return;
    void sendMessage(text.trim(), with_);
  };

  // Sent while an answer comes in, it waits for that answer as its own
  // message, rather than running into what's typed next.
  const [queued, setQueued] = useState(false);
  const wasAnswering = useRef(answering);
  const chatId = useAssistantStore((s) => s.chat?.id ?? null);
  const wasChat = useRef(chatId);
  useEffect(() => {
    const ended = wasAnswering.current && !answering;
    // A new chat gets its id while answering; any other change is a switch.
    const switched = wasChat.current !== null && wasChat.current !== chatId;
    wasAnswering.current = answering;
    wasChat.current = chatId;
    if (!queued || (!ended && !switched)) return;
    setQueued(false);
    // Moving to another chat, or an error, leaves it typed, to send or change.
    if (switched || useAssistantStore.getState().ending?.kind === "error") return;
    const { draft: text } = useAssistantStore.getState();
    send(text, shards);
  });

  const turnOn = async () => {
    if (!vault) return;
    try {
      await setMcpVaultAllowed(vault, true);
      await reload();
    } catch {
      toast.error("Couldn't turn it on");
    }
  };

  const isEmpty = messages.length === 0 && !answering;
  // A chat that's there stays readable while the vault is off or the
  // server is down; only the next message waits.
  const blocked = state === "vaultOff" || state === "serverDown";
  const chatsShown = ready || blocked;

  // An answer from a local model that failed: the server may have stopped.
  const ending = useAssistantStore((s) => s.ending);
  const local = setup?.picked?.local === true;
  useEffect(() => {
    if (ending?.kind === "error" && local) void reload();
  }, [ending, local, reload]);

  // Asks the server again, and goes on with the answer that broke off.
  const serverBack = async () => {
    const now = await reload();
    if (setupState(now) !== "ready") return;
    if (useAssistantStore.getState().ending?.kind === "error") void retryAnswer();
  };

  const vaultOff = {
    icon: <FolderIcon className="size-4.5" />,
    text: `${vault ? folderName(vault) : "This vault"} is off for AI`,
    action: (
      <Button type="button" variant="outline" size="sm" onClick={() => void turnOn()}>
        Turn on
      </Button>
    ),
  };
  const serverDown = setup?.serverDown
    ? {
        icon: <ServerOffIcon className="size-4.5" />,
        text: serverDownText(setup.serverDown),
        action: (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void serverBack()}>
              Try again
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openSettings("ai-assistant")}
            >
              Settings
            </Button>
          </div>
        ),
      }
    : null;
  const missing =
    state === "vaultOff" ? vaultOff : state === "serverDown" ? serverDown : null;

  return (
    <aside
      aria-label="Assistant"
      className="flex h-full w-(--assistant-width) flex-col border-l bg-sidebar text-sidebar-foreground text-ui"
    >
      <div className="flex h-toolbar shrink-0 items-center gap-1 border-sidebar-border border-b pr-2.5 pl-3">
        {chatsShown && chat ? (
          <>
            <ChatsMenu title={chat.title} />
            <Hint label="New chat" side="bottom">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={newChat}
                aria-label="New chat"
                className="text-muted-foreground hover:text-foreground"
              >
                <SquarePenIcon />
              </Button>
            </Hint>
          </>
        ) : (
          <>
            <span className="flex-1 pl-1 font-medium">
              {chatsShown ? "New chat" : "Assistant"}
            </span>
            {chatsShown ? <ChatsMenu title={null} /> : null}
          </>
        )}
        <Hint label="Hide assistant" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={closeAssistant}
            aria-label="Hide assistant"
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon />
          </Button>
        </Hint>
      </div>

      {state === "loading" ? (
        <div className="flex-1" />
      ) : state === "noProvider" ? (
        <Center
          icon={<KeyRoundIcon className="size-4.5" />}
          text="No AI provider set up"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openSettings("ai-assistant")}
            >
              Set up
            </Button>
          }
        />
      ) : missing && isEmpty ? (
        <Center {...missing} />
      ) : state === "noModel" && isEmpty ? (
        <Center
          icon={<CpuIcon className="size-4.5" />}
          text="No model picked"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              Pick a model
            </Button>
          }
        />
      ) : isEmpty && openShard && !openShardRemoved && !draft.trim() ? (
        <Starters onAsk={(text) => send(text, [openShard])} />
      ) : isEmpty ? (
        <div className="flex-1" />
      ) : (
        <Messages
          local={local}
          canRetry={!missing}
          serverDown={state === "serverDown"}
        />
      )}
      {missing && !isEmpty ? <Notice {...missing} /> : null}

      <Composer
        draft={draft}
        onDraft={setDraft}
        shards={shards}
        onAdd={(path) => setAdded([...added, path])}
        onRemove={(path) => {
          if (path === openShard) setOpenShardRemoved(true);
          setAdded(added.filter((p) => p !== path));
        }}
        disabled={
          state === "noProvider" || state === "vaultOff" || state === "serverDown"
        }
        canSend={ready && draft.trim().length > 0}
        answering={answering}
        queued={queued}
        onSend={() => (answering ? setQueued(true) : send(draft, shards))}
        onStop={() => {
          setQueued(false);
          stopAnswer();
        }}
        cardRef={setPerch}
        model={
          setup ? (
            <ModelButton
              setup={setup}
              sendFiles={setup.status.sendFiles}
              disabled={state === "noProvider" || state === "vaultOff"}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPicked={() => void reload()}
            />
          ) : null
        }
      />
    </aside>
  );
}
