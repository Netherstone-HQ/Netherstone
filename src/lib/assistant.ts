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
} from "@/lib/commands/assistant";
import { isSamePath, toVaultRelativePath } from "@/lib/drawing-files";
import { shownRecentFiles } from "@/lib/recent-files";
import {
  type ChatView,
  type Ending,
  NO_CHAT,
  searchChat,
  useAssistantStore,
} from "@/store/assistant";
import { useHistoryStore } from "@/store/history";
import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

const store = useAssistantStore;

/** Where a chat shows: in the panel, or under search's Ask. */
type Place = "panel" | "search";

/**
 * An answer being followed. It moves to the panel when search's chat is
 * carried on there.
 */
interface Run {
  place: Place;
  /** Stop was pressed before the chat's id came. */
  stopAsked: boolean;
}

/** The answer each place follows, so only the one shown is. */
const runs: Record<Place, Run | null> = { panel: null, search: null };

function follow(place: Place): Run {
  const run = { place, stopAsked: false };
  runs[place] = run;
  return run;
}

function isFollowed(run: Run) {
  return runs[run.place] === run;
}

function viewOf(place: Place): ChatView {
  const state = store.getState();
  return place === "panel" ? state : searchChat(state);
}

function setView(place: Place, view: Partial<ChatView>) {
  if (place === "panel") store.setState(view);
  else store.setState((state) => ({ search: { ...searchChat(state), ...view } }));
}

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

/** Whether the assistant is on, reading its switch first if it isn't known. */
export async function isAssistantOn(): Promise<boolean> {
  if (store.getState().enabled === null) await loadAssistantEnabled();
  return store.getState().enabled === true;
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
  runs.panel = null;
  store.setState(NO_CHAT);
}

/** Starts a new chat. An answer still coming is saved to its own chat. */
export function newChat() {
  clearChat();
  store.setState({ added: [], openShardRemoved: false });
}

/** Shows a saved chat. */
export async function openChat(id: string) {
  const run = follow("panel");
  const view = await getChat(id);
  if (!isFollowed(run)) return;
  store.setState({
    chat: { id: view.id, title: view.title },
    messages: view.messages,
    changes: view.changes,
    memories: view.memories,
    endings: view.endings,
    answering: null,
    ending: null,
  });
}

function onEvent(event: ChatEvent, text: string, place: Place): Ending | null {
  const { answering, chat } = viewOf(place);
  if (!answering) return null;
  switch (event.type) {
    case "chat":
      setView(place, {
        answering: { ...answering, chat: event.id },
        chat: chat ?? { id: event.id, title: text },
      });
      return null;
    case "text":
      setView(place, {
        answering: {
          ...answering,
          text: answering.text + event.text,
          tool: null,
          retrying: null,
        },
      });
      return null;
    case "reasoning":
      setView(place, {
        answering: {
          ...answering,
          reasoning: answering.reasoning + event.text,
          retrying: null,
        },
      });
      return null;
    case "tool":
      setView(place, {
        answering: {
          ...answering,
          tool: { name: event.name, paths: event.paths },
          retrying: null,
        },
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
    case "retrying":
      setView(place, { answering: { ...answering, retrying: event.error.kind } });
      return null;
    case "sources":
    case "summarized":
      return null;
  }
}

/**
 * Hands `run` the answer's events while it's followed. A stop pressed
 * before the chat's id came is sent once it comes, followed or not.
 */
function listen(run: Run, text: string, onEnding: (ending: Ending) => void) {
  return (event: ChatEvent) => {
    if (event.type === "chat" && run.stopAsked) void stopChat(event.id);
    if (!isFollowed(run)) return;
    const ending = onEvent(event, text, run.place);
    if (ending) onEnding(ending);
  };
}

/**
 * The Recent list as the sidebar shows it, vault-relative. None while
 * Recent is hidden.
 */
function recentPaths(vault: string): string[] {
  const { recentFiles } = useUIStore.getState();
  const { showRecentFiles, recentFilesLimit } = useSettingsStore.getState();
  return shownRecentFiles(recentFiles, vault, showRecentFiles, recentFilesLimit).map(
    (file) => toVaultRelativePath(file.path, vault),
  );
}

/**
 * Sends `text` with `shards` (vault-relative) in the chat shown in
 * `place`. From search, what's typed in the panel stays as it is.
 */
export async function sendMessage(
  text: string,
  shards: string[],
  place: Place = "panel",
) {
  const vault = useVaultStore.getState().currentVaultPath;
  const view = viewOf(place);
  if (!vault || view.answering || !text.trim()) return;
  const run = follow(place);
  const before = view.messages;
  setView(place, {
    messages: [...before, { seq: -1, role: "user", text, shards }],
    answering: { chat: view.chat?.id ?? null, text: "", reasoning: "", tool: null, retrying: null },
    ending: null,
  });
  if (place === "panel") {
    store.setState({ draft: "", added: [], openShardRemoved: false });
  }

  let ending: Ending | null = null;
  try {
    const id = await sendChat(
      view.chat?.id ?? null,
      vault,
      text,
      shards,
      recentPaths(vault),
      listen(run, text, (end) => (ending = end)),
    );
    if (!isFollowed(run)) return;
    const saved = await getChat(id);
    if (!isFollowed(run)) return;
    setView(run.place, {
      chat: { id: saved.id, title: saved.title },
      messages: saved.messages,
      changes: saved.changes,
      memories: saved.memories,
      endings: saved.endings,
      answering: null,
      ending,
    });
    // A chat's first answer, even after one that failed, gets it a short
    // title, without waiting.
    const answered = saved.messages.filter((m) => m.role === "assistant" && m.text);
    if (ending === null && answered.length === 1) void retitle(id);
  } catch (error) {
    if (!isFollowed(run)) return;
    // Nothing was saved: the message goes back to the box.
    const now = viewOf(run.place);
    const sent = now.answering?.chat != null;
    const restore = !sent && place === "panel";
    setView(run.place, {
      messages: sent ? now.messages : before,
      answering: null,
      ending: { kind: "error", error: chatErrorKind(error) },
    });
    if (restore) store.setState({ draft: text, added: shards });
  }
}

/**
 * Goes on with the answer to the chat's last message after it ended on an
 * error: what it proposed before stays, and it carries on from there.
 */
export async function retryAnswer() {
  const state = store.getState();
  const chat = state.chat;
  const vault = useVaultStore.getState().currentVaultPath;
  if (!chat || !vault || state.answering) return;
  const run = follow("panel");
  store.setState({
    answering: { chat: chat.id, text: "", reasoning: "", tool: null, retrying: null },
    ending: null,
  });
  let ending: Ending | null = null;
  try {
    await sendChat(
      chat.id,
      vault,
      "",
      [],
      recentPaths(vault),
      listen(run, "", (end) => (ending = end)),
    );
    if (!isFollowed(run)) return;
    const view = await getChat(chat.id);
    if (!isFollowed(run)) return;
    store.setState({
      messages: view.messages,
      changes: view.changes,
      memories: view.memories,
      endings: view.endings,
      answering: null,
      ending,
    });
    const answered = view.messages.filter((m) => m.role === "assistant" && m.text);
    if (ending === null && answered.length === 1) void retitle(chat.id);
  } catch (error) {
    if (!isFollowed(run)) return;
    store.setState({
      answering: null,
      ending: { kind: "error", error: chatErrorKind(error) },
    });
  }
}

/** Asks `text` from search, in a chat of its own: the panel's stays as it is. */
export async function askFromSearch(text: string) {
  runs.search = null;
  store.setState({ search: NO_CHAT });
  await sendMessage(text, [], "search");
}

/**
 * Search's chat goes on in the panel, with its answer if it's still
 * coming. The panel's chat is left, and an answer it was getting is saved
 * to its own chat.
 */
export function continueSearchChat() {
  const { search } = store.getState();
  if (!search) return;
  const run = runs.search;
  runs.search = null;
  if (run) run.place = "panel";
  runs.panel = run;
  store.setState({ ...search, search: null });
}

/** Search closed without carrying its chat on: its answer stops and it goes. */
export function leaveSearchChat() {
  if (store.getState().search === null) return;
  stopAnswer("search");
  runs.search = null;
  store.setState({ search: null });
}

async function retitle(id: string) {
  try {
    const title = await retitleChat(id);
    for (const place of ["panel", "search"] as const) {
      if (viewOf(place).chat?.id === id) setView(place, { chat: { id, title } });
    }
  } catch {
    // The first message's start stays the title.
  }
}

/** Stops the answer coming in, in the panel unless `place` says. */
export function stopAnswer(place: Place = "panel") {
  const chat = viewOf(place).answering?.chat;
  const run = runs[place];
  if (chat) void stopChat(chat);
  else if (run && viewOf(place).answering) run.stopAsked = true;
}

export async function removeChat(id: string) {
  await deleteChat(id);
  if (store.getState().chat?.id === id) newChat();
}

export async function removeAllChats() {
  await deleteAllChats();
  newChat();
}

// Turned off: the answer stops, changes not applied are discarded and
// memory items not added go, so nothing is left in the shard. The app
// does the same.
store.subscribe((state, previous) => {
  if (state.enabled === false && previous.enabled === true) {
    stopAnswer();
    leaveSearchChat();
    store.setState({
      changes: state.changes.map((change) =>
        change.state === "pending" ? { ...change, state: "discarded" as const } : change,
      ),
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
  leaveSearchChat();
});
