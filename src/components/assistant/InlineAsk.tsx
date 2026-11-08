import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpIcon, LoaderCircleIcon, SquareIcon } from "lucide-react";
import { RangeApi } from "platejs";
import { useEditorRef } from "platejs/react";

import { Button } from "@/components/ui/button";
import {
  applyInlineAsk,
  closeInlineAsk,
  closeInlineAskIfEdited,
  discardInlineAsk,
  inlineAskRange,
  sendInlineAsk,
} from "@/lib/inline-ask";
import { useEditorStore } from "@/store/editor";
import { useInlineAskStore } from "@/store/inline-ask";

import { ModelButton } from "./ModelButton";
import { useSetup } from "./setup";

/** The prompt's least width, in pixels. */
const MIN_WIDTH = 440;
/** How far it reaches past the reading column on each side. */
const OUTSET = 8;
/** Its gap under the block. */
const GAP = 8;

/** A menu opened from the box (model, thinking), portaled outside it. */
const MENU = "[data-radix-popper-content-wrapper]";

const BUTTON = "size-7.5 shrink-0 rounded-[7px]";
const SEND = `${BUTTON} bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50`;
/** Stop is quieter than Send, as in the panel. */
const STOP = `${BUTTON} bg-muted text-foreground hover:bg-accent`;

/** Where the prompt sits: under the block asked about, over the column. */
function usePlace(box: React.RefObject<HTMLDivElement | null>) {
  const editor = useEditorRef();
  const phase = useInlineAskStore((s) => s.phase);
  const preview = useInlineAskStore((s) => s.preview);
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!phase) return;
    const content = editor.api.toDOMNode(editor) as HTMLElement | undefined;
    // The editor's scroller, which the prompt is placed in.
    const frame = content?.offsetParent as HTMLElement | null | undefined;
    if (!content || !frame) return;
    const observer = new ResizeObserver(() => measure());

    function measure() {
      const range = inlineAskRange(editor);
      if (!content || !frame || !range) return;
      // Under the last block, or under the blocks coming in.
      const last = editor.api.block({ at: RangeApi.end(range), highest: true });
      const anchor =
        frame.querySelector("[data-inline-ask-preview]")?.closest(".change-preview") ??
        (last ? editor.api.toDOMNode(last[0]) : undefined);
      if (!anchor) return;
      observer.observe(anchor);
      const at = frame.getBoundingClientRect();
      const style = getComputedStyle(content);
      const padLeft = Number.parseFloat(style.paddingLeft);
      const column =
        content.clientWidth - padLeft - Number.parseFloat(style.paddingRight);
      const left =
        content.getBoundingClientRect().left + padLeft - at.left + frame.scrollLeft - OUTSET;
      setPlace({
        left,
        top: anchor.getBoundingClientRect().bottom - at.top + frame.scrollTop + GAP,
        // Never past the scroller's own width, which leaves out its scrollbar.
        width: Math.min(
          Math.max(MIN_WIDTH, column + OUTSET * 2),
          frame.clientWidth - left - OUTSET,
        ),
      });
    }

    measure();
    observer.observe(content);
    return () => observer.disconnect();
  }, [editor, phase, preview]);

  // Opened under the fold: brought into view.
  useEffect(() => {
    if (place) box.current?.scrollIntoView({ block: "nearest" });
  }, [place, box]);

  return place;
}

/**
 * The prompt under the text asked about: what to ask and the model, then
 * the answer on its way, then Discard or Apply once it's previewed.
 */
export function InlineAsk() {
  const phase = useInlineAskStore((s) => s.phase);
  const prompt = useInlineAskStore((s) => s.prompt);
  const draft = useInlineAskStore((s) => s.draft);
  const error = useInlineAskStore((s) => s.error);
  const { setup, reload } = useSetup(phase !== null);
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const place = usePlace(box);

  // An answer that failed puts what was asked back.
  useEffect(() => {
    if (phase === "prompt") setText(draft);
  }, [phase, draft]);

  // Typing in the text asked about closes it once it's sent.
  const editTick = useEditorStore((s) => s.editTick);
  useEffect(() => {
    closeInlineAskIfEdited();
  }, [editTick]);

  // Leaving the shard closes it.
  useEffect(() => () => closeInlineAsk(), []);

  useEffect(() => {
    if (!phase) return;
    const onKey = (event: KeyboardEvent) => {
      // Escape in the model or thinking menu closes only that menu.
      const target = event.target as Element | null;
      if (event.key !== "Escape" || target?.closest(MENU)) return;
      event.preventDefault();
      discardInlineAsk();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (
        useInlineAskStore.getState().phase !== "prompt" ||
        box.current?.contains(target) ||
        target?.closest(MENU)
      ) {
        return;
      }
      closeInlineAsk();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [phase]);

  if (!phase || !place) return null;

  const ready = setup !== null && setup.picked !== null;
  const send = () => {
    if (ready && text.trim()) void sendInlineAsk(text);
  };

  return (
    <div
      ref={box}
      className="ask-in absolute z-45 cursor-default select-none"
      style={{ left: place.left, top: place.top, width: place.width }}
    >
      <div className="flex items-center gap-1 rounded-[10px] border border-input bg-card p-1.5 shadow-md focus-within:border-ring">
        {phase === "prompt" ? (
          <>
            <input
              ref={input}
              autoFocus
              aria-label="Ask about the selection"
              placeholder="Ask about the selection"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              className="min-w-0 flex-1 select-text bg-transparent px-1 text-ui outline-none placeholder:text-muted-foreground"
            />
            {setup ? (
              <ModelButton
                setup={setup}
                sendFiles={setup.status.sendFiles}
                disabled={false}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPicked={() => void reload()}
                onDone={() => input.current?.focus()}
              />
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              onClick={send}
              disabled={!ready || !text.trim()}
              aria-label="Send"
              className={`${SEND} ml-1`}
            >
              <ArrowUpIcon />
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate px-1 text-muted-foreground text-ui">
              {prompt}
            </span>
            {phase === "working" ? (
              <>
                <span className="flex items-center gap-2 pr-1 text-muted-foreground text-ui-sm">
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                  Waiting for the answer
                </span>
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={discardInlineAsk}
                  aria-label="Stop"
                  className={STOP}
                >
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={discardInlineAsk}
                >
                  Discard
                </Button>
                <Button type="button" size="sm" onClick={applyInlineAsk}>
                  Apply
                </Button>
              </>
            )}
          </>
        )}
      </div>
      {phase === "prompt" && error ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-[10px] border border-input bg-card py-1 pr-1 pl-2.5 shadow-md">
          <span role="alert" className="min-w-0 flex-1 text-destructive text-ui-sm">
            {error}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!ready || !text.trim()}
            onClick={send}
          >
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
