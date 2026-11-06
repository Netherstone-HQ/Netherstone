import type { Work } from "@/components/brand/companion-motion";

/** What the assistant panel's answer has the companion show. */
interface ChatState {
  answering: { tool: { name: string } | null } | null;
  ending: { kind: string } | null;
  messages: unknown[];
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
