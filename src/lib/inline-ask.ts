import {
  type Path,
  type PathRef,
  RangeApi,
  type RangeRef,
  type TElement,
  type TRange,
} from "platejs";
import type { PlateEditor } from "platejs/react";

import { endingText } from "@/components/assistant/setup";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { openShardPath } from "@/lib/assistant-changes";
import { type ChatError, askInline, stopChat } from "@/lib/commands";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useInlineAskStore } from "@/store/inline-ask";
import { useVaultStore } from "@/store/vault";

const store = useInlineAskStore;

/** The Ask open now, in the editor it was opened in. */
interface Open {
  editor: PlateEditor;
  filePath: string;
  /** The text asked about, kept up to date as the shard changes. */
  range: RangeRef;
  /** The top-level blocks asked about, when whole blocks are. */
  blocks: PathRef[];
  /** The request on its way, to stop it. */
  request: string | null;
  /** The text asked about, as it was sent. */
  sent: string | null;
}

let open: Open | null = null;

/** The range asked about now, for the editor to tint or mark. */
export function inlineAskRange(editor: PlateEditor): TRange | null {
  return open?.editor === editor ? open.range.current : null;
}

/** Whether `path` is the last of the whole blocks being previewed. */
export function inlineAskBlock(
  editor: PlateEditor,
  path: Path,
): "removed" | "last" | null {
  if (open?.editor !== editor) return null;
  const { phase, whole } = store.getState();
  if (phase !== "preview" || !whole) return null;
  const paths = open.blocks.map((ref) => ref.current);
  const index = paths.findIndex(
    (p) => p && p.length === path.length && p.every((n, i) => n === path[i]),
  );
  if (index < 0) return null;
  return index === paths.length - 1 ? "last" : "removed";
}

/** The inline Ask plugin's key in the editor. */
export const INLINE_ASK_KEY = "inlineAsk";

/** Whether `editor` has inline Ask: shards opened while the assistant is off don't. */
export function hasInlineAsk(editor: PlateEditor) {
  return INLINE_ASK_KEY in editor.plugins;
}

function redecorate(editor: PlateEditor) {
  editor.api.redecorate();
}

/**
 * Opens the prompt for the editor's selection. Part of one block is asked
 * about as it is; a selection across blocks, or all of one, asks about
 * those whole blocks.
 */
export function openInlineAsk(editor: PlateEditor) {
  const filePath = useEditorStore.getState().currentFilePath;
  const selection = editor.selection;
  if (!filePath || !selection || editor.api.isCollapsed()) return;
  closeInlineAsk();

  // A triple click reaches the start of the next block, and a selection
  // can end at the start of the next piece of text: it ends after its last
  // character instead, where the preview shows what comes in.
  let range = editor.api.unhangRange(selection);
  const [start, end] = RangeApi.edges(range);
  const lastChar = end.offset === 0 ? editor.api.before(end) : undefined;
  if (lastChar && RangeApi.includes(range, lastChar)) {
    range = {
      anchor: start,
      focus: { path: lastChar.path, offset: lastChar.offset + 1 },
    };
  }
  const blocks = editor.api.blocks({ at: range, mode: "highest" });
  if (blocks.length === 0) return;
  const [, first] = blocks[0];
  const [, last] = blocks[blocks.length - 1];
  const all = {
    anchor: editor.api.start(first)!,
    focus: editor.api.end(last)!,
  };
  const whole =
    blocks.length > 1 ||
    editor.api.string(range).trim() === editor.api.string(all).trim();

  open = {
    editor,
    filePath,
    range: editor.api.rangeRef(whole ? all : range),
    blocks: blocks.map(([, path]) => editor.api.pathRef(path)),
    request: null,
    sent: null,
  };
  store.setState({
    phase: "prompt",
    whole,
    prompt: "",
    draft: "",
    preview: null,
    error: null,
  });
  redecorate(editor);
}

/** Closes the Ask, stopping its answer: the shard is as it was. */
export function closeInlineAsk({ refocus = false } = {}) {
  const current = open;
  if (!current) return;
  open = null;
  if (current.request) void stopChat(current.request).catch(() => {});
  const range = current.range.unref();
  for (const ref of current.blocks) ref.unref();
  store.setState({
    phase: null,
    whole: false,
    prompt: "",
    draft: "",
    preview: null,
    error: null,
  });
  redecorate(current.editor);
  if (refocus && range) {
    current.editor.tf.select(range);
    current.editor.tf.focus();
  }
}

function askedText(current: Open) {
  const range = current.range.current;
  return range ? current.editor.api.string(range) : "";
}

/**
 * The text asked about was edited while the answer came or showed: the
 * answer no longer fits it, so the Ask closes and the edit stays.
 */
export function closeInlineAskIfEdited() {
  const current = open;
  if (!current || current.sent === null) return;
  if (askedText(current) !== current.sent) closeInlineAsk();
}

/** The selection as Markdown, to send. */
async function selectionMarkdown(current: Open) {
  const { editor, filePath } = current;
  const range = current.range.current;
  if (!range) return "";
  const nodes = store.getState().whole
    ? current.blocks
        .map((ref) => ref.current)
        .filter((path): path is Path => path !== null)
        .map((path) => editor.api.node(path)?.[0])
        .filter(Boolean)
    : editor.api.fragment(range);
  return serializeMarkdownInWorker(nodes, { filePath });
}

/** A model may still wrap its answer in a code fence. */
function cleanAnswer(text: string) {
  const trimmed = text.trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Part of a block takes inline content only: its blocks run together. */
function asInline(nodes: TElement[]): TElement[] {
  const children = nodes.flatMap((node, index) => {
    const inline = (node.children ?? []).some((child) => "text" in child)
      ? node.children
      : [{ text: "" }];
    return index === 0 ? inline : [{ text: " " }, ...inline];
  });
  return [{ type: "p", children } as TElement];
}

/** Back to the prompt, saying why under it, with what was asked kept. */
function failed(error: ChatError["kind"]) {
  store.setState({ phase: "prompt", error: endingText({ kind: "error", error }) });
}

function errorKind(error: unknown): ChatError["kind"] {
  if (error && typeof error === "object" && "kind" in error) {
    return (error as ChatError).kind;
  }
  return "failed";
}

/** Sends `prompt` about the selection, then previews the answer. */
export async function sendInlineAsk(prompt: string) {
  const current = open;
  const vault = useVaultStore.getState().currentVaultPath;
  const text = prompt.trim();
  if (!current || !vault || !text || store.getState().phase !== "prompt") {
    return;
  }
  const shard = openShardPath(vault, current.filePath);
  if (!shard) return;
  const id = `inline-${crypto.randomUUID()}`;
  current.request = id;
  current.sent = askedText(current);
  store.setState({ phase: "working", prompt: text, draft: text, error: null });

  const still = () => open === current && current.request === id;
  let answer = "";
  let error: ChatError["kind"] | null = null;
  let stopped = false;
  try {
    // What's typed is saved first, so the model reads the shard as it is.
    await flushPendingAutosave();
    const selection = await selectionMarkdown(current);
    if (!still()) return;
    await askInline(
      id,
      vault,
      shard,
      selection,
      store.getState().whole,
      text,
      (event) => {
        if (event.type === "text") answer += event.text;
        else if (event.type === "failed") error = event.error.kind;
        else if (event.type === "stopped") stopped = true;
      },
    );
  } catch (thrown) {
    error = errorKind(thrown);
  }
  if (!still()) return;
  current.request = null;
  if (stopped) {
    closeInlineAsk({ refocus: true });
    return;
  }
  const markdown = cleanAnswer(answer);
  if (error || !markdown) {
    failed(error ?? "failed");
    return;
  }

  const value = (await resolveSessionValue(
    current.filePath,
    markdown,
    null,
  )) as TElement[];
  if (open !== current) return;
  if (value.length === 0) {
    failed("failed");
    return;
  }
  store.setState({
    phase: "preview",
    preview: store.getState().whole ? value : asInline(value),
  });
  redecorate(current.editor);
}

/** Writes the answer in the selection's place, as an edit Undo takes back. */
export function applyInlineAsk() {
  const current = open;
  const { phase, whole, preview } = store.getState();
  if (!current || phase !== "preview" || !preview) return;
  const { editor } = current;
  const nodes = preview as TElement[];
  const range = current.range.current;
  const paths = current.blocks
    .map((ref) => ref.current)
    .filter((path): path is Path => path !== null);
  closeInlineAsk();
  if (!range) return;

  editor.tf.withNewBatch(() => {
    if (whole && paths.length > 0) {
      for (const path of [...paths].reverse()) {
        editor.tf.removeNodes({ at: path });
      }
      editor.tf.insertNodes(nodes, { at: paths[0] });
      const end = editor.api.end([paths[0][0] + nodes.length - 1]);
      if (end) editor.tf.select(end);
    } else {
      editor.tf.select(range);
      editor.tf.insertFragment(nodes);
    }
  });
  editor.tf.focus();
}

/** Discard, Escape or Stop: the text stays as it was. */
export function discardInlineAsk() {
  closeInlineAsk({ refocus: true });
}

// Turned off: the Ask closes and the shard is as it was.
useAssistantStore.subscribe((state, previous) => {
  if (state.enabled === false && previous.enabled !== false) closeInlineAsk();
});
