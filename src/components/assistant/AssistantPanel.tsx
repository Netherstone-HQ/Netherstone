import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  CpuIcon,
  FolderIcon,
  ImageOffIcon,
  KeyRoundIcon,
  Link2Icon,
  LoaderCircleIcon,
  NewspaperIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import {
  closeAssistant,
  newChat,
  sendMessage,
  stopAnswer,
} from "@/lib/assistant";
import {
  type AssistantStatus,
  type ChatError,
  type ModelChoice,
  type PickedModel,
  type ShownMessage,
  getAssistantStatus,
  getPickedModel,
  listMcpVaults,
  setAssistantModel,
  setMcpVaultAllowed,
} from "@/lib/commands";
import { folderName } from "@/lib/open-vault";
import { isSamePath, toVaultRelativePath } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { openWebLink } from "@/lib/open-web-link";
import { cn } from "@/lib/utils";
import { type Ending, useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

import {
  AnswerText,
  type Citation,
  CiteNumber,
  citationsIn,
} from "./AnswerText";
import { ChatsMenu } from "./ChatsMenu";
import { Composer, shardName } from "./Composer";
import { ModelList, isSetUp, useModelLists } from "./models";

/** What the panel needs to know before a chat can start. */
interface Setup {
  status: AssistantStatus;
  picked: PickedModel | null;
  /** Whether the open vault is on for AI. */
  vaultAllowed: boolean;
}

/** Read when the panel opens, and again on leaving Settings. */
function useSetup() {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const inSettings = useUIStore((s) => s.activeNavItem === "settings");
  const [setup, setSetup] = useState<Setup | null>(null);

  const load = useCallback(async () => {
    try {
      const [status, picked, vaults] = await Promise.all([
        getAssistantStatus(),
        getPickedModel().catch(() => null),
        listMcpVaults(),
      ]);
      const vaultAllowed =
        vault !== null &&
        vaults.some((v) => v.allowed && isSamePath(v.path, vault));
      setSetup({ status, picked, vaultAllowed });
    } catch (error) {
      console.error("[Netherstone] Couldn't read the assistant's setup:", error);
    }
  }, [vault]);

  useEffect(() => {
    if (!inSettings) void load();
  }, [load, inSettings]);

  return { setup, reload: load };
}

function vaultPath(vault: string, path: string) {
  const separator = vault.includes("\\") ? "\\" : "/";
  return (
    vault.replace(/[\\/]+$/, "") + separator + path.split("/").join(separator)
  );
}

function openShard(citation: Citation) {
  const vault = useVaultStore.getState().currentVaultPath;
  if (!vault) return;
  void openVaultFile(vaultPath(vault, citation.path)).catch(() =>
    toast.error(`Couldn't open ${shardName(citation.path)}`),
  );
}

/** Opens web links only: an answer could hold any kind of link. */
function openLink(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void openWebLink(href).catch(() => toast.error("Couldn't open the link"));
}

const ERRORS: Record<ChatError["kind"], string> = {
  keyRefused: "The provider turned down the key",
  unreachable: "Couldn't reach the provider",
  rateLimited: "The provider is getting too many requests, try again soon",
  busy: "The provider is busy, try again soon",
  timedOut: "The provider stopped answering",
  tooLong: "This chat is longer than the model can read, start a new one",
  failed: "The provider couldn't answer",
  stopped: "Stopped",
  noModel: "No model picked",
  turnedOff: "The assistant is off",
  vaultClosed: "This vault is off for AI",
  answering: "This chat is still answering",
  noChat: "This chat was deleted",
  storage: "Couldn't save the chat",
};

function endingText(ending: Ending) {
  switch (ending.kind) {
    case "error":
      return ERRORS[ending.error];
    case "stop":
      return ending.stop === "length"
        ? "The answer reached the model's length limit"
        : "The provider held the answer back";
    case "stepLimit":
      return "Stopped after too many steps";
    case "stopped":
      return "Stopped";
  }
}

/** What a tool the model runs is doing, as the panel says it. */
function activity(tool: { name: string; paths: string[] }) {
  const name = tool.paths[0] ? shardName(tool.paths[0]) : null;
  switch (tool.name) {
    case "search":
      return "Searching the vault";
    case "read":
      return name ? `Reading ${name}` : "Reading";
    case "read_drawing":
      return name ? `Looking at ${name}` : "Looking at a drawing";
    case "list_folder":
      return name ? `Looking in ${name}` : "Looking through folders";
    case "links":
      return "Following links";
    case "list_tags":
      return "Looking at tags";
    case "vault_overview":
      return "Looking over the vault";
    default:
      return "Working";
  }
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

function Answer({ message }: { message: ShownMessage }) {
  const cited = citationsIn(message.text);
  return (
    <div className="flex flex-col gap-2.5">
      {message.reasoning ? <Thinking text={message.reasoning} /> : null}
      {message.text ? (
        <AnswerText
          text={message.text}
          cited={cited}
          onOpenShard={openShard}
          onOpenLink={openLink}
        />
      ) : null}
      <Sources cited={cited} read={message.sources ?? []} />
      {message.text ? (
        <div className="-ml-1.5 flex gap-0.5">
          <CopyButton text={message.text} />
        </div>
      ) : null}
    </div>
  );
}

function UserMessage({ message }: { message: ShownMessage }) {
  return (
    <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[10px] bg-muted px-3 py-2">
      {message.text}
    </div>
  );
}

function Streaming() {
  const answering = useAssistantStore((s) => s.answering);
  if (!answering) return null;
  const cited = citationsIn(answering.text);
  return (
    <div className="flex flex-col gap-2.5">
      {answering.text ? (
        <AnswerText
          text={answering.text}
          cited={cited}
          onOpenShard={openShard}
          onOpenLink={openLink}
        />
      ) : null}
      {answering.tool || !answering.text ? (
        <p className="flex items-center gap-2 text-muted-foreground text-ui-sm">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {answering.tool
            ? activity(answering.tool)
            : answering.reasoning
              ? "Thinking"
              : "Waiting for the answer"}
        </p>
      ) : null}
    </div>
  );
}

/** Keeps the newest message in view while it grows, unless scrolled up. */
function useStickToBottom(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const element = ref.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const onScroll = () => {
    const element = ref.current;
    if (!element) return;
    stuck.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  };
  return { ref, onScroll };
}

function Messages() {
  const messages = useAssistantStore((s) => s.messages);
  const answering = useAssistantStore((s) => s.answering);
  const ending = useAssistantStore((s) => s.ending);
  const { ref, onScroll } = useStickToBottom([messages, answering, ending]);

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      {messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.seq} message={message} />
        ) : (
          <Answer key={message.seq} message={message} />
        ),
      )}
      <Streaming />
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

/** The model the chat uses, and the list to pick another. */
function ModelButton({
  setup,
  sendFiles,
  disabled,
  open,
  onOpenChange,
  onPicked,
}: {
  setup: Setup;
  sendFiles: boolean;
  /** Shown but not usable, while the panel asks for something first. */
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: () => void;
}) {
  const { models, loadAll } = useModelLists();
  const { picked, status } = setup;
  const hasProvider = status.providers.some(isSetUp);

  // Listed each time it opens, from the button or the panel's Pick a model.
  useEffect(() => {
    if (open) loadAll(status.providers);
  }, [open, loadAll, status.providers]);

  const pick = async (choice: ModelChoice) => {
    onOpenChange(false);
    try {
      await setAssistantModel(choice);
      onPicked();
    } catch {
      toast.error("Couldn't pick that model");
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Model"
            disabled={!hasProvider || disabled}
            className="flex h-7 min-w-0 items-center gap-1 rounded-md pr-1.5 pl-2 text-muted-foreground text-ui-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none"
          >
            {picked ? (
              <>
                <span className="truncate">{picked.name ?? picked.id}</span>
                <Dot className="mx-1" />
                <span className="shrink-0">
                  {picked.local ? "Local" : picked.provider}
                </span>
              </>
            ) : (
              <span>{hasProvider ? "Pick a model" : "No model"}</span>
            )}
            {hasProvider && !disabled ? (
              <ChevronDownIcon className="size-3.5 shrink-0" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-75 p-0">
          <ModelList
            providers={status.providers}
            models={models}
            value={status.model}
            onPick={(choice) => void pick(choice)}
          />
        </PopoverContent>
      </Popover>
      {picked && !picked.images && sendFiles && !disabled ? (
        <Hint label="This model can't see images" side="top">
          <span
            aria-label="This model can't see images"
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ImageOffIcon className="size-3.5" />
          </span>
        </Hint>
      ) : null}
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
  const answering = useAssistantStore((s) => s.answering);
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

  const openShard =
    vault && openPath && /\.md$/i.test(openPath)
      ? toVaultRelativePath(openPath, vault)
      : null;
  const shards = [
    ...(openShard && !openShardRemoved ? [openShard] : []),
    ...added.filter((path) => path !== openShard),
  ];

  const hasProvider = setup?.status.providers.some(isSetUp) ?? false;
  const state = !setup
    ? "loading"
    : !hasProvider
      ? "noProvider"
      : !setup.vaultAllowed
        ? "vaultOff"
        : !setup.picked
          ? "noModel"
          : "ready";
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
        answering={answering !== null}
        onSend={() => send(draft, shards)}
        onStop={stopAnswer}
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
