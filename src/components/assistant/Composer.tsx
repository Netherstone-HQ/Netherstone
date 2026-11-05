import { useMemo, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { ArrowUpIcon, FileIcon, SquareIcon, XIcon } from "lucide-react";

import { DrawingIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getVaultFileDisplayName, isDrawingPath } from "@/lib/drawing-files";
import { cn } from "@/lib/utils";
import { type FileTreeNode, useVaultStore } from "@/store/vault";
import { toVaultRelativePath } from "@/lib/drawing-files";

/** A shard's name from its vault-relative path. */
export function shardName(path: string) {
  return getVaultFileDisplayName(path.split("/").pop() ?? path);
}

const MAX_MATCHES = 8;

function ShardIcon({ path, className }: { path: string; className: string }) {
  return isDrawingPath(path) ? (
    <DrawingIcon className={className} />
  ) : (
    <FileIcon className={className} />
  );
}

function shardsIn(tree: FileTreeNode[], vault: string): string[] {
  const found: string[] = [];
  const walk = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "directory") walk(node.children ?? []);
      else if (/\.md$/i.test(node.name) || isDrawingPath(node.name)) {
        found.push(toVaultRelativePath(node.path, vault));
      }
    }
  };
  walk(tree);
  return found;
}

/** The `@words` typed just before the caret, if any. */
function mentionAt(text: string, caret: number) {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

function ShardChip({
  path,
  onRemove,
}: {
  path: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6.5 max-w-full items-center gap-1.5 rounded-md bg-muted pr-1.5 pl-2 text-foreground text-ui-sm">
      <ShardIcon path={path} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{shardName(path)}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${shardName(path)} from this message`}
        className="-mr-0.5 inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

/**
 * Where a message is written: the shards going with it, the text with @
 * to add a shard, the model, and Send or Stop.
 */
export function Composer({
  draft,
  onDraft,
  shards,
  onAdd,
  onRemove,
  disabled,
  canSend,
  answering,
  onSend,
  onStop,
  model,
}: {
  draft: string;
  onDraft: (draft: string) => void;
  /** The shards going with the message, vault-relative. */
  shards: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  disabled: boolean;
  canSend: boolean;
  answering: boolean;
  onSend: () => void;
  onStop: () => void;
  model: React.ReactNode;
}) {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const tree = useVaultStore((s) => s.fileTree);
  const allShards = useMemo(
    () => (vault ? shardsIn(tree, vault) : []),
    [tree, vault],
  );
  const textRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return allShards
      .filter((path) => !shards.includes(path))
      .filter((path) => shardName(path).toLowerCase().includes(query))
      .sort(
        (a, b) =>
          Number(!shardName(a).toLowerCase().startsWith(query)) -
          Number(!shardName(b).toLowerCase().startsWith(query)),
      )
      .slice(0, MAX_MATCHES);
  }, [mention, allShards, shards]);

  const track = (text: string, caret: number) => {
    const found = mentionAt(text, caret);
    setMention(found);
    if (found?.query !== mention?.query) setActive(0);
  };

  const pick = (path: string) => {
    if (!mention) return;
    const caret = textRef.current?.selectionStart ?? draft.length;
    const next = draft.slice(0, mention.start) + draft.slice(caret);
    onDraft(next);
    onAdd(path);
    setMention(null);
    requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(mention.start, mention.start);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (mention && matches.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]);
        return;
      }
    }
    if (mention && event.key === "Escape") {
      event.preventDefault();
      setMention(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !answering) onSend();
    }
  };

  const send =
    "size-7.5 shrink-0 rounded-[7px] bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50";

  return (
    <div className={cn("shrink-0 p-3", disabled && "opacity-50")}>
      <div className="relative flex flex-col gap-2 rounded-[10px] border border-input bg-card p-2 focus-within:border-ring">
        {mention && matches.length > 0 ? (
          <div
            role="listbox"
            aria-label="Shards"
            className="absolute inset-x-2 bottom-[calc(100%+6px)] z-10 flex flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {matches.map((path, index) => (
              <div
                key={path}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(path);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex h-7.5 cursor-default items-center gap-2 rounded-sm px-2 text-ui",
                  index === active && "bg-accent",
                )}
              >
                <ShardIcon path={path} className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{shardName(path)}</span>
                {path.includes("/") ? (
                  <span className="ml-auto truncate pl-2 text-muted-foreground text-ui-sm">
                    {path.split("/").slice(0, -1).join("/")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {shards.length > 0 && !disabled ? (
          <div className="flex flex-wrap gap-1.5">
            {shards.map((path) => (
              <ShardChip
                key={path}
                path={path}
                onRemove={() => onRemove(path)}
              />
            ))}
          </div>
        ) : null}
        <div className="relative flex flex-col">
          {mention ? (
            // The @ being typed is tinted: the text is drawn here, under the
            // box's own text, which is clear meanwhile.
            <div
              ref={backdropRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 text-ui"
            >
              {draft.slice(0, mention.start)}
              <span className="text-brand">
                {draft.slice(mention.start, mention.start + mention.query.length + 1)}
              </span>
              {draft.slice(mention.start + mention.query.length + 1)}
            </div>
          ) : null}
          <TextareaAutosize
            ref={textRef}
            aria-label="Message"
            placeholder={
              disabled ? "Ask about your vault" : "Ask about your vault, @ to add a shard"
            }
            disabled={disabled}
            value={draft}
            minRows={2}
            maxRows={10}
            onChange={(event) => {
              onDraft(event.target.value);
              track(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) =>
              track(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onBlur={() => setMention(null)}
            onKeyDown={onKeyDown}
            onScroll={(event) => {
              if (backdropRef.current) {
                backdropRef.current.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            className={cn(
              "relative resize-none break-words bg-transparent px-1 text-ui outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
              mention && "text-transparent caret-foreground",
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">{model}</div>
          {answering ? (
            <Button
              type="button"
              size="icon-sm"
              onClick={onStop}
              aria-label="Stop"
              className={send}
            >
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              onClick={onSend}
              disabled={disabled || !canSend}
              aria-label="Send"
              className={send}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
