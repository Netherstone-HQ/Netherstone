import { memo, useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, CopyIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Hint } from "@/components/ui/tooltip";
import { addAnswerToShard } from "@/lib/assistant-changes";
import type {
  ChatChange,
  ChatMemory,
  ShownMessage,
} from "@/lib/commands/assistant";
import { cn } from "@/lib/utils";

import {
  AnswerText,
  type Citation,
  CiteNumber,
  useParsedAnswer,
  withoutCitations,
} from "../AnswerText";
import { shardName } from "../Composer";
import { AllChanges, ChangeCard } from "./ChangeCard";
import { MemoryCard } from "./MemoryCard";
import { openLink, openShard } from "./open";

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

/**
 * The thinking shown open now, by its text, so it stays open when an
 * answer streaming in is saved and shown again.
 */
const openThinking = new Set<string>();

export function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(() => openThinking.has(text));
  // Kept as it grows, so it's found once the answer is saved.
  useEffect(() => {
    if (!open) return;
    openThinking.add(text);
    return () => {
      openThinking.delete(text);
    };
  }, [open, text]);
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
          {/* Thinking often ends in blank lines. */}
          {text.trim()}
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

export const Answer = memo(function Answer({
  message,
  changes,
  memories,
  canAdd,
  copy,
}: {
  message: ShownMessage;
  /** The changes the answer proposed, under it. */
  changes: ChatChange[];
  /** The memory items the answer offered, under it. */
  memories: ChatMemory[];
  /** Whether a shard is open to add the answer to. */
  canAdd: boolean;
  /**
   * The whole answer, on its last message, for its Copy row. Steps before
   * it have none, so they sit close.
   */
  copy?: string;
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
      {copy && cards === 0 ? (
        // Shown on the answer the pointer or focus is on, so they don't
        // stack up under every answer.
        <div className="-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/answer:opacity-100">
          <CopyButton text={copy} />
          {canAdd ? <AddToShardButton text={copy} /> : null}
        </div>
      ) : null}
    </div>
  );
});
