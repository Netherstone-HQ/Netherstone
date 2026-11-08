import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  ServerOffIcon,
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
  retryAnswer,
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
import { EndingNote } from "./EndingNote";
import { ModelButton } from "./ModelButton";
import { Composer, shardName } from "./Composer";
import {
  serverDownText,
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

/** The folder a vault path is in, as a card names it. */
function folderOf(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.length > 0 ? parts.join("/") : "the top of the vault";
}

/** Where a move takes it, and its new name, as a card says them. */
function moveParts(change: ChatChange) {
  const { folder = null, name = null } = change.moving ?? {};
  return {
    where: folder === null ? null : folder === "" ? "the top of the vault" : folder,
    renamed: name ? shardName(name) : null,
  };
}

/** What a change does, as its card says it before it's applied. */
function changeTitle(change: ChatChange) {
  const name = shardName(change.path);
  switch (change.kind) {
    case "newShard":
      return `New shard ${name} in ${folderOf(change.path)}`;
    case "newDrawing":
      return `New drawing ${name} in ${folderOf(change.path)}`;
    case "move": {
      const { where, renamed } = moveParts(change);
      if (where !== null && renamed) return `Move ${name} to ${where} as ${renamed}`;
      if (where !== null) return `Move ${name} to ${where}`;
      return `Rename ${name} to ${renamed ?? ""}`;
    }
    default:
      return name;
  }
}

/** What an applied change did, around the link to what it left. */
function appliedWords(change: ChatChange): [string, string] {
  switch (change.kind) {
    case "newShard":
    case "newDrawing":
      return ["Created ", ` in ${folderOf(change.path)}`];
    case "move": {
      const { where, renamed } = moveParts(change);
      const old = shardName(change.path);
      if (where === null) return [`Renamed ${old} to `, ""];
      return renamed ? [`Moved ${old} to ${where} as `, ""] : ["Moved ", ` to ${where}`];
    }
    default:
      return ["Applied to ", ""];
  }
}

/** What a discarded change would have done, as its trace says it. */
function discardedTitle(change: ChatChange) {
  const title = changeTitle(change);
  return change.kind === "shard" || change.kind === "drawing"
    ? `Discarded the change to ${title}`
    : `Discarded: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
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

/** Where the file a change made or changed is once it's applied. */
function appliedPath(change: ChatChange): string {
  if (change.kind !== "move") return change.path;
  const { folder = null, name = null } = change.moving ?? {};
  const parts = change.path.split("/");
  const old = parts.pop() ?? change.path;
  const extension = /\.(md|excalidraw)$/i.exec(old)?.[0] ?? "";
  const renamed = name
    ? name.toLowerCase().endsWith(extension.toLowerCase())
      ? name
      : name + extension
    : old;
  const where = folder === null ? parts.join("/") : folder;
  return where ? `${where}/${renamed}` : renamed;
}

/** Brings the open shard's preview of a change back into view. */
function revealPreview() {
  // Set aside to edit: shown again, and it brings the change into view.
  if (useAssistantStore.getState().previewSetAside !== null) {
    useAssistantStore.setState({ previewSetAside: null });
    return;
  }
  document
    .querySelector(".change-preview [data-history-block]")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/**
 * A file's name in a change card that opens it, or for a change to the
 * open shard, brings its preview there into view.
 */
function FileLink({
  path,
  onOpen,
  children,
}: {
  path: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen ?? (() => openShard({ path, section: null }))}
      className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}

/**
 * A change an answer proposed: to look at, then apply or not. A change to
 * the open shard shows in its place, and its name brings it back into
 * view; one to another shard opens it from its name; a new shard or
 * drawing, or a changed drawing, shows in the card; a move says where it
 * goes. Once applied, its name opens what it made or changed.
 */
function ChangeCard({ change }: { change: ChatChange }) {
  const busy = useAssistantStore((s) => s.busyChanges.includes(change.id));
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  if (change.state === "discarded") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-dashed py-2.5 pr-2 pl-3 text-muted-foreground">
        <XIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{discardedTitle(change)}</span>
      </div>
    );
  }
  if (change.state === "applied") {
    const path = appliedPath(change);
    const [before, after] = appliedWords(change);
    return (
      <div className="flex items-center gap-2 rounded-[10px] border bg-card py-2.5 pr-2 pl-3">
        <CheckIcon className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 break-words">
          {before}
          {isOpenable(path) ? (
            <FileLink path={path}>{shardName(path)}</FileLink>
          ) : (
            shardName(path)
          )}
          {after}
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
  const onOpenShard =
    change.kind === "shard" && openShardPath(vault, openPath) === change.path;
  const linked = change.kind === "shard" || change.kind === "drawing";
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <ChangeIcon kind={change.kind} />
        {linked ? (
          <FileLink
            path={change.path}
            onOpen={onOpenShard ? revealPreview : undefined}
          >
            {title}
          </FileLink>
        ) : (
          <span
            className={cn(
              "min-w-0 font-medium",
              change.kind === "move" ? "break-words" : "truncate",
            )}
          >
            {title}
          </span>
        )}
        {(change.kind === "shard" || change.kind === "drawing") && (
          <span className="shrink-0 text-muted-foreground text-ui-sm">
            {changeCount(change.count)}
          </span>
        )}
      </div>
      {inCard && <ChangeContent change={change} label={`Preview of ${title}`} />}
      <div className="flex justify-end gap-2">
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
          {change.kind === "newShard" || change.kind === "newDrawing" ? "Create" : "Apply"}
        </Button>
      </div>
    </div>
  );
}

/** Apply all and Discard all, for an answer with more than one change left. */
function AllChanges({ changes }: { changes: ChatChange[] }) {
  const pending = changes.filter((change) => change.state === "pending");
  const [running, setRunning] = useState(false);
  const busy = useAssistantStore((s) =>
    pending.some((change) => s.busyChanges.includes(change.id)),
  );
  if (pending.length < 2) return null;
  const each = async (run: (change: ChatChange) => Promise<void>) => {
    const chat = useAssistantStore.getState().chat?.id;
    setRunning(true);
    try {
      for (const { id } of pending) {
        // Each as it stands now: one may have been done from its own card.
        const now = useAssistantStore.getState();
        if (now.chat?.id !== chat) break;
        const change = now.changes.find((c) => c.id === id);
        if (change?.state === "pending") await run(change);
      }
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || running}
        onClick={() => void each(discardAssistantChange)}
      >
        Discard all
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy || running}
        onClick={() => void each(applyAssistantChange)}
      >
        Apply all
      </Button>
    </div>
  );
}

/** Whether a path names a shard or drawing, rather than a folder. */
function isOpenable(path: string) {
  return /\.(md|excalidraw)$/i.test(path);
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

/** The shards an answer cites, numbered as in its text. */
function Sources({ cited }: { cited: Citation[] }) {
  if (cited.length === 0) return null;
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
    <div className="group/answer flex flex-col gap-2.5">
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
      <AllChanges changes={changes} />
      {memories.map((memory) => (
        <MemoryCard key={memory.id} memory={memory} />
      ))}
      <Sources cited={answer.cited} />
      {message.text && cards === 0 ? (
        // Shown on the answer the pointer or focus is on, so they don't
        // stack up under every answer.
        <div className="-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/answer:opacity-100">
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
      turn,
      /** The turn's last message, answered or not. */
      endsTurn: !next || next.role === "user",
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
function Streaming({ onGrow, local }: { onGrow: () => void; local: boolean }) {
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
          {waitingText(answering, local)}
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

function Messages({
  local,
  canRetry,
  serverDown,
}: {
  local: boolean;
  canRetry: boolean;
  /** The notice under the chat already says the server isn't running. */
  serverDown: boolean;
}) {
  const messages = useAssistantStore((s) => s.messages);
  const changes = useAssistantStore((s) => s.changes);
  const memories = useAssistantStore((s) => s.memories);
  const ending = useAssistantStore((s) => s.ending);
  const endings = useAssistantStore((s) => s.endings);
  const answering = useAssistantStore((s) => s.answering !== null);
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
    endings,
  ]);
  // New arrays only when the chat changes, so answers that didn't change
  // don't render again.
  const shown = useMemo(
    () => withChanges(messages, changes, memories),
    [messages, changes, memories],
  );
  const lastAsked = [...messages].reverse().find((m) => m.role === "user")?.seq;
  // The last turn's ending as it ended here, or as it was kept. None while
  // it's being answered again, and no error while the server notice says why.
  const ended = answering
    ? null
    : (ending ?? endings.find((saved) => saved.turn === lastAsked)?.ending ?? null);
  const lastEnding = serverDown && ended?.kind === "error" ? null : ended;
  const endedEarlier = (turn: number) =>
    turn === lastAsked
      ? null
      : (endings.find((saved) => saved.turn === turn)?.ending ?? null);

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4",
        perched && "pb-[96px]",
      )}
    >
      {shown.map(({ message, changes, memories, turn, endsTurn }) => {
        const earlier = endsTurn ? endedEarlier(turn) : null;
        return (
          <Fragment key={message.seq}>
            {message.role === "user" ? (
              <UserMessage message={message} />
            ) : (
              <Answer
                message={message}
                changes={changes}
                memories={memories}
                canAdd={canAdd}
              />
            )}
            {earlier ? <EndingNote ending={earlier} onOpenLink={openLink} /> : null}
          </Fragment>
        );
      })}
      <Streaming onGrow={follow} local={local} />
      {lastEnding ? (
        <EndingNote
          ending={lastEnding}
          onOpenLink={openLink}
          onRetry={canRetry ? () => void retryAnswer() : undefined}
          partly={changes.some((change) => change.turn === lastAsked)}
        />
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
