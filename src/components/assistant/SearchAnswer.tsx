import { toast } from "sonner";
import {
  CpuIcon,
  FolderIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  ServerOffIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { setMcpVaultAllowed } from "@/lib/commands/mcp";
import type { Citation } from "@/lib/open-citation";
import { openWebLink } from "@/lib/open-web-link";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";
import { useVaultStore } from "@/store/vault";

import { AnswerText, CiteNumber, useParsedAnswer } from "./AnswerText";
import { shardName } from "./Composer";
import { EndingNote } from "./EndingNote";
import { type Setup, type SetupState, serverDownText, waitingText } from "./setup";

/** A group's name in the search list, like Recent. */
export function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2.5 pt-2 pb-1 font-medium text-muted-foreground text-ui-sm">
      {children}
    </p>
  );
}

/** The row that asks what's typed. */
export function AskRow({
  selected,
  onAsk,
  onHover,
}: {
  selected: boolean;
  onAsk: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAsk}
      onMouseEnter={onHover}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui outline-none",
        selected && "bg-accent",
      )}
    >
      <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
      Ask about this
    </button>
  );
}

/** Opens web links only: an answer could hold any kind of link. */
function openLink(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void openWebLink(href).catch(() => toast.error("Couldn't open the link"));
}

/** The answer asked from search, as it streams in and once it's done. */
export function SearchAnswer({
  onOpenShard,
  onContinue,
}: {
  onOpenShard: (citation: Citation) => void;
  onContinue: () => void;
}) {
  const answering = useAssistantStore((s) => s.answering);
  const messages = useAssistantStore((s) => s.messages);
  const ending = useAssistantStore((s) => s.ending);
  const chat = useAssistantStore((s) => s.chat);

  const text = answering
    ? answering.text
    : messages
        .filter((m) => m.role === "assistant" && m.text)
        .map((m) => m.text)
        .join("\n\n");
  const answer = useParsedAnswer(text);

  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-accent p-3 text-ui">
      {text ? (
        <AnswerText
          answer={answer}
          onOpenShard={onOpenShard}
          onOpenLink={openLink}
        />
      ) : null}
      {answering && (answering.tool || !answering.text) ? (
        <p className="flex items-center gap-2 text-muted-foreground text-ui-sm">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          {waitingText(answering)}
        </p>
      ) : null}
      {ending ? <EndingNote ending={ending} onOpenLink={openLink} /> : null}
      {answer.cited.length > 0 || chat ? (
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
            {answer.cited.map((citation, index) => (
              <button
                key={citation.path}
                type="button"
                onClick={() => onOpenShard(citation)}
                className="flex min-w-0 items-center gap-2 rounded-sm text-ui-sm hover:text-foreground/80"
              >
                <CiteNumber number={index + 1} />
                <span className="truncate">{shardName(citation.path)}</span>
              </button>
            ))}
          </div>
          {chat ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onContinue}
            >
              Continue in chat
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What's needed before the question can be asked, as the panel says it. */
export function SearchSetupNeeded({
  state,
  setup,
  onSetUp,
  onPickModel,
  onTurnedOn,
}: {
  state: Exclude<SetupState, "ready">;
  setup: Setup | null;
  onSetUp: () => void;
  onPickModel: () => void;
  /** Reads the setup again, after turning the vault on or for Try again. */
  onTurnedOn: () => void;
}) {
  const vault = useVaultStore((s) => s.currentVaultPath);

  const turnOn = async () => {
    if (!vault) return;
    try {
      await setMcpVaultAllowed(vault, true);
      onTurnedOn();
    } catch {
      toast.error("Couldn't turn it on");
    }
  };

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 px-2.5 py-1.5 text-muted-foreground text-ui-sm">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Waiting for the answer
      </p>
    );
  }

  const [Icon, text, action, onAction] =
    state === "noProvider"
      ? [KeyRoundIcon, "No AI provider set up", "Set up", onSetUp]
      : state === "vaultOff"
        ? [
            FolderIcon,
            "AI is off for this vault",
            "Turn on",
            () => void turnOn(),
          ]
        : state === "serverDown" && setup?.serverDown
          ? [ServerOffIcon, serverDownText(setup.serverDown), "Try again", onTurnedOn]
          : [CpuIcon, "No model picked", "Pick a model", onPickModel];

  return (
    <div className="flex items-center gap-2.5 py-1 pr-1 pl-2.5 text-ui">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-muted-foreground">{text}</span>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}
