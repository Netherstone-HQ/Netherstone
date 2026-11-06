import { create } from "zustand";

/**
 * Where an inline Ask is: the prompt open, the answer on its way, or its
 * preview shown in the shard.
 *
 * Section 9 hook: when Kevin is the assistant, he plays Reading while the
 * phase is "working" and Done when it turns "preview".
 */
type InlineAskPhase = "prompt" | "working" | "preview";

interface InlineAskState {
  /** Null while no Ask is open. */
  phase: InlineAskPhase | null;
  /** Whether whole blocks are asked about, rather than part of one. */
  whole: boolean;
  /** What was asked, once sent. */
  prompt: string;
  /** Typed and not sent, kept when an answer fails. */
  draft: string;
  /** What comes in, as editor nodes, while the preview shows. */
  preview: unknown[] | null;
}

export const useInlineAskStore = create<InlineAskState>(() => ({
  phase: null,
  whole: false,
  prompt: "",
  draft: "",
  preview: null,
}));
