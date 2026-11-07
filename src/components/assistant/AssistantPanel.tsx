import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderInputIcon,
  KeyRoundIcon,
  Link2Icon,
  LoaderCircleIcon,
  NewspaperIcon,
  PlusIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { DrawingIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Hint } from "@/components/ui/tooltip";
import {
  closeAssistant,
  newChat,
  sendMessage,
  stopAnswer,
} from "@/lib/assistant";
import {
  addAnswerToShard,
  applyAssistantChange,
  discardAssistantChange,
  openShardPath,
  undoAssistantChange,
} from "@/lib/assistant-changes";
import {
  applyMemory,
  discardMemory,
  undoMemory,
} from "@/lib/assistant-memory";
import {
  type ChatChange,
  type ChatMemory,
  type ShownMessage,
  setMcpVaultAllowed,
} from "@/lib/commands";
import { folderName } from "@/lib/open-vault";
import { openCitation } from "@/lib/open-citation";
import { openWebLink } from "@/lib/open-web-link";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";
import { useCompanionStore } from "@/store/companion";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

import {
  AnswerText,
  type Citation,
  CiteNumber,
  useParsedAnswer,
  withoutCitations,
} from "./AnswerText";
import { ChangeContent } from "./ChangeContent";
import { ChatsMenu } from "./ChatsMenu";
import { ModelButton } from "./ModelButton";
import { Composer, shardName } from "./Composer";
import {
  endingText,
  setupState,
  useSetup,
  waitingText,
} from "./setup";

function openShard(citation: Citation) {
  void openCitation(citation);
}

/** Opens web links only: an answer could hold any kind of link. */
function openLink(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void openWebLink(href).catch(() => toast.error("Couldn't open the link"));
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Hint label={copied ? "Copied" : "Copy"} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Copy"
        className="text-muted-foreground hover:text-foreground"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => toast.error("Couldn't copy the answer"),
          )
        }
      >
        {copied ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </Hint>
  );
}

function AddToShardButton({ text }: { text: string }) {
  const [added, setAdded] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-muted-foreground text-ui-sm hover:text-foreground"
      onClick={() =>
        void addAnswerToShard(withoutCitations(text)).then(
          (done) => {
            if (done) setAdded(true);
            else toast.error("Open a shard to add the answer to");
          },
          () => toast.error("Couldn't add the answer to the shard"),
        )
      }
    >
      {added ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <PlusIcon className="size-3.5" />
      )}
      Add to shard
    </Button>
  );
}

function changeCount(count: number) {
  return count === 1 ? "1 change" : `${count} changes`;
}

/** What a change does, as its card says it. */
function changeTitle(change: ChatChange) {
  const name = shardName(change.path);
  switch (change.kind) {
    case "newShard":
      return `New shard ${name}`;
    case "newDrawing":
      return `New drawing ${name}`;
    case "move": {
      const { folder = null, name: renamed = null } = change.moving ?? {};
      const where = folder === "" ? "the top of the vault" : folder;
      if (where !== null && renamed) {
        return `Move ${change.path} to ${where} as ${renamed}`;
      }
      if (where !== null) return `Move ${change.path} to ${where}`;
      return `Rename ${change.path} to ${renamed ?? ""}`;
    }
    default:
      return name;
  }
}

function ChangeIcon({ kind }: { kind: ChatChange["kind"] }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case "newShard":
      return <FilePlusIcon className={className} />;
    case "drawing":
    case "newDrawing":
      return <DrawingIcon className={className} />;
    case "move":
      return <FolderInputIcon className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}

/**
 * A change an answer proposed: to look at, then apply or not. A change to
 * the open shard shows in its place; one to another shard opens it; a new
 * shard or a drawing shows in the card; a move says where it goes.
 */
function ChangeCard({ change }: { change: ChatChange }) {
  const busy = useAssistantStore((s) => s.busyChanges.includes(change.id));
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const [showing, setShowing] = useState(false);
  if (change.state === "applied") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border bg-card py-2.5 pr-2 pl-3">
        <CheckIcon className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">
          Applied to {shardName(change.path)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void undoAssistantChange(change)}
        >
          Undo
        </Button>
      </div>
    );
  }
  const title = changeTitle(change);
  const inCard = change.kind !== "shard" && change.kind !== "move";
  const elsewhere =
    change.kind === "shard" && openShardPath(vault, openPath) !== change.path;
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <ChangeIcon kind={change.kind} />
        <span
          className={cn(
            "min-w-0 font-medium",
            change.kind === "move" ? "break-words" : "truncate",
          )}
        >
          {title}
        </span>
        {change.kind !== "move" && (
          <span className="shrink-0 text-muted-foreground text-ui-sm">
            {changeCount(change.count)}
          </span>
        )}
      </div>
      {inCard && showing && (
        <ChangeContent change={change} label={`Preview of ${title}`} />
      )}
      <div className="flex justify-end gap-2">
        {(inCard || elsewhere) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() =>
              inCard
                ? setShowing((shown) => !shown)
                : openShard({ path: change.path, section: null })
            }
          >
            {inCard && showing ? "Hide" : "Show"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void discardAssistantChange(change)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void applyAssistantChange(change)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

/** An item an answer offered to remember: to add to memory or not. */
function MemoryCard({ memory }: { memory: ChatMemory }) {
  const busy = useAssistantStore((s) => s.busyChanges.includes(memory.id));
  if (memory.state === "applied") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border bg-card py-2.5 pr-2 pl-3">
        <CheckIcon className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">Added to memory</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void undoMemory(memory)}
        >
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border bg-card p-3">
      <div className="flex items-center gap-2">
        <BrainIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Add to memory</span>
      </div>
      <p className="break-words">{memory.text}</p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void discardMemory(memory)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void applyMemory(memory)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 text-muted-foreground text-ui-sm hover:text-foreground"
      >
        Thinking
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <p className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground text-ui-sm">
          {text}
        </p>
      ) : null}
    </div>
  );
}

/** The shards an answer cites, numbered, or the ones it read. */
function Sources({ cited, read }: { cited: Citation[]; read: string[] }) {
  const rest = cited.length === 0 ? read : [];
  if (cited.length === 0 && rest.length === 0) return null;
  return (
    <div className="-mx-2 flex flex-col">
      {cited.map((citation, index) => (
        <button
          key={citation.path}
          type="button"
          onClick={() => openShard(citation)}
          className="flex h-7.5 min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-sm hover:bg-accent"
        >
          <CiteNumber number={index + 1} />
          <span className="truncate">{shardName(citation.path)}</span>
          {citation.section ? (
            <>
              <Dot className="mx-0" />
              <span className="truncate text-muted-foreground">
                {citation.section}
              </span>
            </>
          ) : null}
        </button>
      ))}
      {rest.map((path) => (
        <button
          key={path}
          type="button"
          onClick={() => openShard({ path, section: null })}
          className="flex h-7.5 min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-sm hover:bg-accent"
        >
          <span className="truncate">{shardName(path)}</span>
        </button>
      ))}
    </div>
  );
}

const Answer = memo(function Answer({
  message,
  changes,
  memories,
  canAdd,
}: {
  message: ShownMessage;
  /** The changes the answer proposed, under it. */
  changes: ChatChange[];
  /** The memory items the answer offered, under it. */
  memories: ChatMemory[];
  /** Whether a shard is open to add the answer to. */
  canAdd: boolean;
}) {
  const answer = useParsedAnswer(message.text);
  const cards = changes.length + memories.length;
  if (!message.text && !message.reasoning && cards === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {message.reasoning ? <Thinking text={message.reasoning} /> : null}
      {message.text ? (
        <AnswerText
          answer={answer}
          onOpenShard={openShard}
          onOpenLink={openLink}
        />
      ) : null}
      {changes.map((change) => (
        <ChangeCard key={change.id} change={change} />
      ))}
      {memories.map((memory) => (
        <MemoryCard key={memory.id} memory={memory} />
      ))}
      <Sources cited={answer.cited} read={message.sources ?? []} />
      {message.text && cards === 0 ? (
        <div className="-ml-1.5 flex items-center gap-0.5">
          <CopyButton text={message.text} />
          {canAdd ? <AddToShardButton text={message.text} /> : null}
        </div>
      ) : null}
    </div>
  );
});

/**
 * Each message, with the changes and memory items an answer offered under
 * the last message of that answer.
 */
function withChanges(
  messages: ShownMessage[],
  changes: ChatChange[],
  memories: ChatMemory[],
) {
  let turn = 0;
  return messages.map((message, index) => {
    if (message.role === "user") turn = message.seq;
    const next = messages[index + 1];
    const endsAnswer =
      message.role === "assistant" && (!next || next.role === "user");
    return {
      message,
      changes: endsAnswer ? changes.filter((c) => c.turn === turn) : [],
      memories: endsAnswer ? memories.filter((m) => m.turn === turn) : [],
    };
  });
}

function UserMessage({ message }: { message: ShownMessage }) {
  return (
    <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[10px] bg-muted px-3 py-2">
      {message.text}
    </div>
  );
}

/**
 * The answer as it comes in. The only part of the chat that changes while
 * it streams, so it alone re-renders, and it keeps itself in view.
 */
function Streaming({ onGrow }: { onGrow: () => void }) {
  const answering = useAssistantStore((s) => s.answering);
  const answer = useParsedAnswer(answering?.text ?? "");
  useEffect(onGrow, [answering, onGrow]);
  if (!answering) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {answering.text ? (
        <AnswerText
          answer={answer}
          onOpenShard={openShard}
          onOpenLink={openLink}
        />
      ) : null}
      {answering.tool || !answering.text ? (
        <p className="flex items-center gap-2 text-muted-foreground text-ui-sm">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {waitingText(answering)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Keeps the newest message in view while it grows, unless scrolled up:
 * when `deps` change, or when `follow` is called.
 */
function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const follow = useCallback(() => {
    const element = ref.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(follow, deps);
  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    stuck.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };
  return { ref, onScroll, follow };
}

function Messages() {
  const messages = useAssistantStore((s) => s.messages);
  const changes = useAssistantStore((s) => s.changes);
  const memories = useAssistantStore((s) => s.memories);
  const ending = useAssistantStore((s) => s.ending);
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const canAdd = openShardPath(vault, openPath) !== null;
  // Room under the last message while the companion sits on the composer.
  const perched = useCompanionStore((s) => s.perched);
  const { ref, onScroll, follow } = useStickToBottom([
    messages,
    changes,
    memories,
    ending,
  ]);
  // New arrays only when the chat changes, so answers that didn't change
  // don't render again.
  const shown = useMemo(
    () => withChanges(messages, changes, memories),
    [messages, changes, memories],
  );

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4",
        perched && "pb-[96px]",
      )}
    >
      {shown.map(
        ({ message, changes, memories }) =>
        message.role === "user" ? (
          <UserMessage key={message.seq} message={message} />
        ) : (
          <Answer
            key={message.seq}
            message={message}
            changes={changes}
            memories={memories}
            canAdd={canAdd}
          />
        ),
      )}
      <Streaming onGrow={follow} />
      {ending ? (
        <p
          role={ending.kind === "error" ? "alert" : undefined}
          className={cn(
            "text-ui-sm",
            ending.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {endingText(ending)}
        </p>
      ) : null}
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

  return (
    <aside
      aria-label="Assistant"
      className="flex h-full w-100 flex-col border-l bg-sidebar text-sidebar-foreground text-ui"
    >
      <div className="flex h-toolbar shrink-0 items-center gap-1 border-sidebar-border border-b pr-2.5 pl-3">
        {ready && chat ? (
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
              {ready ? "New chat" : "Assistant"}
            </span>
            {ready ? <ChatsMenu title={null} /> : null}
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
      ) : state === "vaultOff" ? (
        <Center
          icon={<FolderIcon className="size-4.5" />}
          text={`${vault ? folderName(vault) : "This vault"} is off for AI`}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void turnOn()}
            >
              Turn on
            </Button>
          }
        />
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
        <Messages />
      )}

      <Composer
        draft={draft}
        onDraft={setDraft}
        shards={shards}
        onAdd={(path) => setAdded([...added, path])}
        onRemove={(path) => {
          if (path === openShard) setOpenShardRemoved(true);
          setAdded(added.filter((p) => p !== path));
        }}
        disabled={state === "noProvider" || state === "vaultOff"}
        canSend={ready && draft.trim().length > 0}
        answering={answering}
        onSend={() => send(draft, shards)}
        onStop={stopAnswer}
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
