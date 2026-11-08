import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { LoaderCircleIcon } from "lucide-react";

import { retryAnswer } from "@/lib/assistant";
import { openShardPath } from "@/lib/assistant-changes";
import type {
  ChatChange,
  ChatMemory,
  ShownMessage,
} from "@/lib/commands/assistant";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";
import { useCompanionStore } from "@/store/companion";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

import { AnswerText, useParsedAnswer } from "../AnswerText";
import { EndingNote } from "../EndingNote";
import { waitingText } from "../setup";
import { Answer } from "./Answer";
import { openLink, openShard } from "./open";

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

export function Messages({
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
