import { create } from "zustand";
import type {
  ChatChange,
  ChatError,
  ChatMemory,
  SavedEnding,
  ShownMessage,
} from "@/lib/commands/assistant";

/** An answer streaming in. */
interface Answering {
  /** Known once the first event comes. */
  chat: string | null;
  /**
   * The steps before the last tool, each saved as its own message: shown
   * apart, as they will be once saved.
   */
  steps: { text: string; reasoning: string }[];
  /** The step coming in now. */
  text: string;
  reasoning: string;
  /** The tool running now, if one is. */
  tool: { name: string; paths: string[] } | null;
  /** Why the provider is being asked again, while it waits to. */
  retrying: ChatError["kind"] | null;
}

/** How an answer ended, when it didn't end well. */
export type Ending = SavedEnding["ending"];

/** A chat as it's shown: the panel's, or the one asked from search. */
export interface ChatView {
  /** The chat shown, or null for a new one. */
  chat: { id: string; title: string } | null;
  messages: ShownMessage[];
  /** The changes the chat's answers proposed, pending or applied. */
  changes: ChatChange[];
  /** The memory items the chat's answers offered, pending or added. */
  memories: ChatMemory[];
  answering: Answering | null;
  /** How the answer shown last ended, as it ends here. */
  ending: Ending | null;
  /** How the chat's earlier answers ended, kept with the chat. */
  endings: SavedEnding[];
}

export const NO_CHAT: ChatView = {
  chat: null,
  messages: [],
  changes: [],
  memories: [],
  answering: null,
  ending: null,
  endings: [],
};

interface AssistantState extends ChatView {
  /** The assistant's switch in Settings. Null until it's read. */
  enabled: boolean | null;
  /** Whether the panel is open in the right sidebar's place. */
  isOpen: boolean;
  /** Changes being applied, undone or discarded now. */
  busyChanges: string[];
  /**
   * The chat asked from search, apart from the panel's until it's carried
   * on there. Null while search hasn't asked.
   */
  search: ChatView | null;
  /** What's typed but not sent. */
  draft: string;
  /** Shards added with @, vault-relative. */
  added: string[];
  /** Whether the open shard was taken out of the next message. */
  openShardRemoved: boolean;
  /** Asks the composer to take focus once it's shown. */
  focusComposer: boolean;
  /** A change to the open shard set aside to edit it, by id. */
  previewSetAside: string | null;

  setEnabled: (enabled: boolean) => void;
  setOpen: (isOpen: boolean) => void;
  setDraft: (draft: string) => void;
  setAdded: (added: string[]) => void;
  setOpenShardRemoved: (removed: boolean) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  enabled: null,
  isOpen: false,
  ...NO_CHAT,
  busyChanges: [],
  search: null,
  draft: "",
  added: [],
  openShardRemoved: false,
  focusComposer: false,
  previewSetAside: null,

  setEnabled: (enabled) =>
    set((state) => ({ enabled, isOpen: enabled && state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
  setDraft: (draft) => set({ draft }),
  setAdded: (added) => set({ added }),
  setOpenShardRemoved: (openShardRemoved) => set({ openShardRemoved }),
}));

/** The chat asked from search, or none. */
export function searchChat(state: { search: ChatView | null }): ChatView {
  return state.search ?? NO_CHAT;
}
