import {
  type ChatError,
  type ChatEvent,
  deleteAllChats,
  deleteChat,
  getAssistantEnabled,
  getChat,
  retitleChat,
  sendChat,
  stopChat,
} from "@/lib/commands";
import { isSamePath } from "@/lib/drawing-files";
import { type Ending, useAssistantStore } from "@/store/assistant";
import { useHistoryStore } from "@/store/history";
import { useVaultStore } from "@/store/vault";

const store = useAssistantStore;

/** Counts answers, so only the one shown is followed. */
let followed = 0;
/** Stop was pressed before the chat's id came. */
let stopAsked = false;

function chatErrorKind(error: unknown): ChatError["kind"] {
  if (error && typeof error === "object" && "kind" in error) {
    return (error as ChatError).kind;
  }
  return "failed";
}

/**
 * Reads the assistant's switch, for the top bar button. Reads nothing else,
 * so with the assistant off no key is read. Left unknown when it can't be
 * read, so the next look tries again.
 */
export async function loadAssistantEnabled() {
  try {
    store.getState().setEnabled(await getAssistantEnabled());
  } catch (error) {
    console.error("[Netherstone] Couldn't read the assistant's switch:", error);
  }
}

/** Opens the panel in the right sidebar's place, closing History there. */
export function openAssistant() {
  const history = useHistoryStore.getState();
  if (history.openIn === "notes") history.closeHistory();
  store.getState().setOpen(true);
}

export function closeAssistant() {
  store.getState().setOpen(false);
}

/** Shows no chat. An answer still coming is saved to its own chat. */
function clearChat() {
  followed += 1;
  stopAsked = false;
  store.setState({
    chat: null,
    messages: [],
    changes: [],
    memories: [],
    answering: null,
    ending: null,
  });
}

/** Starts a new chat. An answer still coming is saved to its own chat. */
export function newChat() {
  clearChat();
  store.setState({ added: [], openShardRemoved: false });
}

/** Shows a saved chat. */
export async function openChat(id: string) {
  const run = ++followed;
  stopAsked = false;
  const view = await getChat(id);
  if (run !== followed) return;
  store.setState({
    chat: { id: view.id, title: view.title },
    messages: view.messages,
    changes: view.changes,
    memories: view.memories,
    answering: null,
    ending: null,
  });
}

function onEvent(event: ChatEvent, text: string): Ending | null {
  const { answering, chat } = store.getState();
  if (!answering) return null;
  switch (event.type) {
    case "chat":
      store.setState({
        answering: { ...answering, chat: event.id },
        chat: chat ?? { id: event.id, title: text },
      });
      if (stopAsked) void stopChat(event.id);
      return null;
    case "text":
      store.setState({
        answering: { ...answering, text: answering.text + event.text, tool: null },
      });
      return null;
    case "reasoning":
      store.setState({
        answering: { ...answering, reasoning: answering.reasoning + event.text },
      });
      return null;
    case "tool":
      store.setState({
        answering: { ...answering, tool: { name: event.name, paths: event.paths } },
      });
      return null;
    case "done":
      return event.stop === "length" || event.stop === "filtered"
        ? { kind: "stop", stop: event.stop }
        : null;
    case "stepLimit":
      return { kind: "stepLimit" };
    case "failed":
      return { kind: "error", error: event.error.kind };
    case "stopped":
      return { kind: "stopped" };
    case "sources":
    case "summarized":
      return null;
  }
}

/**
 * Sends `text` with `shards` (vault-relative) in the chat shown. From
 * search, what's typed in the panel stays as it is.
 */
export async function sendMessage(
  text: string,
  shards: string[],
  { fromSearch = false } = {},
) {
  const vault = useVaultStore.getState().currentVaultPath;
  const state = store.getState();
  if (!vault || state.answering || !text.trim()) return;
  const run = ++followed;
  stopAsked = false;
  const before = state.messages;
  store.setState({
    messages: [...before, { seq: -1, role: "user", text, shards }],
    answering: { chat: state.chat?.id ?? null, text: "", reasoning: "", tool: null },
    ending: null,
    ...(fromSearch ? {} : { draft: "", added: [], openShardRemoved: false }),
  });

  let ending: Ending | null = null;
  try {
    const id = await sendChat(state.chat?.id ?? null, vault, text, shards, (event) => {
      if (run !== followed) return;
      ending = onEvent(event, text) ?? ending;
    });
    if (run !== followed) return;
    const view = await getChat(id);
    if (run !== followed) return;
    store.setState({
      chat: { id: view.id, title: view.title },
      messages: view.messages,
      changes: view.changes,
      memories: view.memories,
      answering: null,
      ending,
    });
    // A new chat that got its answer gets a short title, without waiting.
    if (state.chat === null && ending === null) void retitle(id);
  } catch (error) {
    if (run !== followed) return;
    // Nothing was saved: the message goes back to the box.
    const sent = store.getState().answering?.chat != null;
    const restore = !sent && !fromSearch;
    store.setState({
      messages: sent ? store.getState().messages : before,
      draft: restore ? text : store.getState().draft,
      added: restore ? shards : store.getState().added,
      answering: null,
      ending: { kind: "error", error: chatErrorKind(error) },
    });
  }
}

/** Asks `text` from search, in a new chat the panel can carry on. */
export async function askFromSearch(text: string) {
  clearChat();
  await sendMessage(text, [], { fromSearch: true });
}

async function retitle(id: string) {
  try {
    const title = await retitleChat(id);
    const { chat } = store.getState();
    if (chat?.id === id) store.setState({ chat: { id, title } });
  } catch {
    // The first message's start stays the title.
  }
}

/** Stops the answer coming in. */
export function stopAnswer() {
  const chat = store.getState().answering?.chat;
  if (chat) void stopChat(chat);
  else stopAsked = true;
}

export async function removeChat(id: string) {
  await deleteChat(id);
  if (store.getState().chat?.id === id) newChat();
}

export async function removeAllChats() {
  await deleteAllChats();
  newChat();
}

// Turned off: the answer stops and the changes and memory items not
// applied go, so nothing is left in the shard or the panel. The app drops
// them too.
store.subscribe((state, previous) => {
  if (state.enabled === false && previous.enabled === true) {
    stopAnswer();
    store.setState({
      changes: state.changes.filter((change) => change.state !== "pending"),
      memories: state.memories.filter((memory) => memory.state !== "pending"),
    });
  }
});

// History and the panel share the right sidebar's place.
useHistoryStore.subscribe((state, previous) => {
  if (state.openIn === "notes" && previous.openIn !== "notes") {
    closeAssistant();
  }
});

// A chat belongs to its vault: another vault starts a new one.
useVaultStore.subscribe((state, previous) => {
  const now = state.currentVaultPath;
  const before = previous.currentVaultPath;
  if (now === before || (now && before && isSamePath(now, before))) return;
  newChat();
});
