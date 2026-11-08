import { create } from "zustand";
import type {
  ChatChange,
  ChatMemory,
  ChatError,
  ChatStop,
  ShownMessage,
} from "@/lib/commands/assistant";

/** An answer streaming in. */
interface Answering {
  /** Known once the first event comes. */
  chat: string | null;
  text: string;
  reasoning: string;
  /** The tool running now, if one is. */
  tool: { name: string; paths: string[] } | null;
}

/** How the last answer ended, when it didn't end well. */
export type Ending =
  | { kind: "error"; error: ChatError["kind"] }
  | { kind: "stop"; stop: Exclude<ChatStop, "done" | "tools"> }
  | { kind: "stepLimit" }
  | { kind: "stopped" };

interface AssistantState {
  /** The assistant's switch in Settings. Null until it's read. */
  enabled: boolean | null;
  /** Whether the panel is open in the right sidebar's place. */
  isOpen: boolean;
  /** The chat shown, or null for a new one. */
  chat: { id: string; title: string } | null;
  messages: ShownMessage[];
  /** The changes the chat's answers proposed, pending or applied. */
  changes: ChatChange[];
  /** Changes being applied, undone or discarded now. */
  busyChanges: string[];
  /** The memory items the chat's answers offered, pending or added. */
  memories: ChatMemory[];
  answering: Answering | null;
  ending: Ending | null;
  /** What's typed but not sent. */
  draft: string;
  /** Shards added with @, vault-relative. */
  added: string[];
  /** Whether the open shard was taken out of the next message. */
  openShardRemoved: boolean;
  /** Asks the composer to take focus once it's shown. */
  focusComposer: boolean;

  setEnabled: (enabled: boolean) => void;
  setOpen: (isOpen: boolean) => void;
  setDraft: (draft: string) => void;
  setAdded: (added: string[]) => void;
  setOpenShardRemoved: (removed: boolean) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  enabled: null,
  isOpen: false,
  chat: null,
  messages: [],
  changes: [],
  busyChanges: [],
  memories: [],
  answering: null,
  ending: null,
  draft: "",
  added: [],
  openShardRemoved: false,
  focusComposer: false,

  setEnabled: (enabled) =>
    set((state) => ({ enabled, isOpen: enabled && state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
  setDraft: (draft) => set({ draft }),
  setAdded: (added) => set({ added }),
  setOpenShardRemoved: (openShardRemoved) => set({ openShardRemoved }),
}));
