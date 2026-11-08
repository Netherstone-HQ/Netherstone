import type { Work } from "@/components/brand/companion-motion";

/** What the assistant panel's answer has the companion show. */
interface ChatState {
  chat: { id: string } | null;
  answering: { tool: { name: string; paths?: string[] } | null } | null;
  ending: { kind: string } | null;
  messages: unknown[];
  changes: readonly { id: string; turn: number; state: string }[];
}

/**
 * Searching while the vault is searched, Reading while anything else is on
 * its way, then Done, or a shrug when it failed. Null when nothing changed.
 */
export function chatWork(previous: ChatState, next: ChatState): Work | null {
  if (next.answering) {
    return next.answering.tool?.name === "search" ? "search" : "read";
  }
  if (!previous.answering) return null;
  // A new chat started while the answer was coming.
  if (next.messages.length === 0) return "idle";
  if (!next.ending) return "done";
  return next.ending.kind === "error" ? "shrug" : "idle";
}

/** The tools that change a file, each a change to the first path it names. */
const CHANGE_TOOLS = new Set(["edit_shard", "create_shard", "move", "edit_drawing"]);

/**
 * Whether an answer starting now goes on with the one before it, as Try
 * again does after an error: same chat, no new message.
 */
function goesOn(previous: ChatState, next: ChatState) {
  return (
    previous.ending?.kind === "error" &&
    previous.chat?.id === next.chat?.id &&
    previous.messages.length === next.messages.length
  );
}

/**
 * The files the turn's answer has changed so far, given the ones before
 * and the tool that just started. Calls on the same file are one change,
 * as in the panel. A new message starts again from none; Try again after
 * an error carries on counting.
 */
export function changedFiles(
  changed: readonly string[],
  previous: ChatState,
  next: ChatState,
): readonly string[] {
  if (!next.answering) return changed;
  const starting = !previous.answering;
  const since = starting && !goesOn(previous, next) ? [] : changed;
  const tool = next.answering.tool;
  if (!tool || tool === previous.answering?.tool) return since;
  if (!CHANGE_TOOLS.has(tool.name)) return since;
  // A new shard is named only by its folder: each one counts on its own.
  const file =
    tool.name === "create_shard" || !tool.paths?.[0]
      ? `${tool.name}#${since.length}`
      : tool.paths[0];
  return since.includes(file) ? since : [...since, file];
}

/**
 * Whether a change from the last answer, shown as pending, was just
 * discarded once that answer was in.
 */
export function discarded(previous: ChatState, next: ChatState) {
  if (next.answering) return false;
  const last = Math.max(...next.changes.map((c) => c.turn));
  const pending = new Set(
    previous.changes.filter((c) => c.state === "pending").map((c) => c.id),
  );
  return next.changes.some(
    (c) => c.turn === last && c.state === "discarded" && pending.has(c.id),
  );
}

type InlinePhase = "prompt" | "working" | "preview" | null;

/**
 * Reading while an inline Ask's answer is on its way, then Done when its
 * preview lands. A failed answer goes back to the prompt with a shrug, and
 * one stopped closes the Ask. Null when nothing changed.
 */
export function inlineWork(previous: InlinePhase, next: InlinePhase): Work | null {
  if (previous === next) return null;
  if (next === "working") return "read";
  if (previous !== "working") return null;
  if (next === "preview") return "done";
  if (next === "prompt") return "shrug";
  return "idle";
}
