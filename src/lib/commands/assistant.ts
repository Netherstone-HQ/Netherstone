import { Channel, invoke } from "@tauri-apps/api/core";

/** How an address's API is spoken. */
export type AssistantApi =
  | "openAi"
  | "anthropic"
  | "google"
  | "openRouter"
  | "ollama";

export type KeyStorage = "keyring" | "file" | "memory";

export interface AssistantModel {
  id: string;
  /** The name people know it by, when the catalog knows it. */
  name?: string;
  context?: number;
  output?: number;
  reasoning: boolean;
  tools: boolean;
  images: boolean;
  pdfs: boolean;
  caching: boolean;
  responsesOnly: boolean;
}

export interface LocalServer {
  kind: "ollama" | "lmStudio" | "llamaCpp" | "other";
  /** Like `http://localhost:11434`. */
  address: string;
}

export interface FoundServer extends LocalServer {
  models: AssistantModel[];
}

export interface AssistantProvider {
  id: string;
  name: string;
  setup: "key" | "local" | "custom";
  keyPage: string | null;
  /** Where its key is kept, once saved. */
  key: KeyStorage | null;
  servers: LocalServer[];
  custom: { address: string; api: AssistantApi } | null;
}

export interface ModelChoice {
  provider: string;
  /** The local server's address, for a local model. */
  server: string | null;
  model: string;
}

export interface AssistantStatus {
  enabled: boolean;
  /** Whether a shard's images and PDFs go to the model with it. */
  sendFiles: boolean;
  keyringAvailable: boolean;
  model: ModelChoice | null;
  providers: AssistantProvider[];
}

/** Why a provider couldn't be used, as the app reports it. */
export interface ProviderError {
  kind:
    | "keyRefused"
    | "unreachable"
    | "noModels"
    | "rateLimited"
    | "insecure"
    | "notLocal"
    | "badAddress"
    | "failed"
    | "storage";
}

export async function getAssistantStatus(): Promise<AssistantStatus> {
  return invoke("assistant_status");
}

/** Whether the assistant is on, with no key or provider read. */
export async function getAssistantEnabled(): Promise<boolean> {
  return invoke("assistant_enabled");
}

export async function setAssistantEnabled(enabled: boolean): Promise<void> {
  await invoke("assistant_set_enabled", { enabled });
}

export async function setAssistantModel(
  choice: ModelChoice | null,
): Promise<void> {
  await invoke("assistant_set_model", { choice });
}

export async function listAssistantModels(
  provider: string,
  server: string | null = null,
): Promise<AssistantModel[]> {
  return invoke("assistant_models", { provider, server });
}

/** Checks the key with its provider, then saves it. */
export async function saveAssistantKey(
  provider: string,
  key: string,
  remember: boolean,
): Promise<AssistantModel[]> {
  return invoke("assistant_save_key", { provider, key, remember });
}

/** Looks for servers on their usual ports and keeps the ones found. */
export async function findLocalServers(): Promise<FoundServer[]> {
  return invoke("assistant_find_local");
}

/** The picked local server's kind while it isn't answering, else null. */
export async function findLocalServerDown(): Promise<LocalServer["kind"] | null> {
  return invoke("assistant_local_down");
}

export async function saveLocalServer(address: string): Promise<FoundServer> {
  return invoke("assistant_save_local", { address });
}

export async function saveCustomProvider(
  address: string,
  api: AssistantApi,
  key: string | null,
  remember: boolean,
): Promise<AssistantModel[]> {
  return invoke("assistant_save_custom", { address, api, key, remember });
}

export async function removeAssistantProvider(provider: string): Promise<void> {
  await invoke("assistant_remove", { provider });
}

export async function setAssistantSendFiles(on: boolean): Promise<void> {
  await invoke("assistant_set_send_files", { on });
}

/** The picked model, as the assistant panel shows it. */
export interface PickedModel {
  id: string;
  /** The name people know it by, when the catalog knows it. */
  name?: string;
  provider: string;
  local: boolean;
  /** Whether it takes images. */
  images: boolean;
}

/** Null when no model is picked or its provider isn't set up anymore. */
export async function getPickedModel(): Promise<PickedModel | null> {
  return invoke("assistant_picked");
}

/** Why a chat couldn't go on, as the app reports it. */
export interface ChatError {
  kind:
    | "keyRefused"
    | "unreachable"
    | "rateLimited"
    | "busy"
    | "timedOut"
    | "tooLong"
    | "contextTooSmall"
    | "failed"
    | "stopped"
    | "noModel"
    | "turnedOff"
    | "vaultClosed"
    | "answering"
    | "noChat"
    | "storage";
}

type ChatStop = "done" | "tools" | "length" | "filtered";

/** What the panel hears while a chat answers, in order. */
export type ChatEvent =
  | { type: "chat"; id: string }
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string; paths: string[] }
  | { type: "sources"; shards: string[] }
  | { type: "summarized" }
  | { type: "retrying"; error: ChatError }
  | { type: "done"; stop: ChatStop }
  | { type: "stepLimit" }
  | { type: "failed"; error: ChatError }
  | { type: "stopped" };

export interface ChatInfo {
  id: string;
  title: string;
  vault: string;
  /** Milliseconds since 1970. */
  created: number;
  updated: number;
}

/** A message as the panel shows it. */
export interface ShownMessage {
  seq: number;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  /** Shards added to a user's message, vault-relative. */
  shards?: string[];
  tools?: string[];
  /** Shards the answer read, vault-relative. */
  sources?: string[];
  model?: string;
}

/** A change an answer proposed to one file. */
export interface ChatChange {
  id: string;
  /** The user message it answers. */
  turn: number;
  kind: "shard" | "newShard" | "drawing" | "newDrawing" | "move";
  /** Vault-relative: the file it changes, or where a new one goes. */
  path: string;
  /** How many calls make it. */
  count: number;
  state: "pending" | "applied" | "discarded";
  /** For a move: the folder it goes to ("" for the top), and its new name. */
  moving?: { folder: string | null; name: string | null };
}

/** An item an answer offered to add to memory. */
export interface ChatMemory {
  id: string;
  /** The user message it answers. */
  turn: number;
  text: string;
  state: "pending" | "applied";
}

export interface ChatView extends ChatInfo {
  messages: ShownMessage[];
  changes: ChatChange[];
  memories: ChatMemory[];
  /** How answers that didn't end well ended, by the turn they answered. */
  endings: SavedEnding[];
}

/** An answer's ending, kept with the turn it answered. */
export interface SavedEnding {
  turn: number;
  ending:
    | { kind: "error"; error: ChatError["kind"] }
    | { kind: "stop"; stop: Exclude<ChatStop, "done" | "tools"> }
    | { kind: "stepLimit" }
    | { kind: "stopped" };
}

/**
 * A pending change to a shard or drawing: its text now (empty for a new
 * one) and as applying leaves it.
 */
export interface ChangePreview {
  path: string;
  before: string;
  after: string;
}

/** What applying or undoing left the change's file with; null when it's gone. */
export interface MadeChange {
  path: string;
  content: string | null;
}

export async function previewChange(change: string): Promise<ChangePreview> {
  return invoke("assistant_change_preview", { change });
}

/** `expected`: the shard's text as the editor shows it, when it's open. */
export async function applyChange(
  change: string,
  expected: string | null,
): Promise<MadeChange> {
  return invoke("assistant_apply", { change, expected });
}

export async function undoChange(change: string): Promise<MadeChange> {
  return invoke("assistant_undo", { change });
}

export async function discardChange(change: string): Promise<void> {
  await invoke("assistant_discard", { change });
}

/**
 * Sends `text` in `chat`, or starts a chat about `vault`, with `shards`
 * added and the user's Recent list (vault-relative). Events stream to `onEvent`; resolves with the chat's id once the
 * answer ends.
 */
export async function sendChat(
  chat: string | null,
  vault: string,
  text: string,
  shards: string[],
  recent: string[],
  onEvent: (event: ChatEvent) => void,
): Promise<string> {
  const events = new Channel<ChatEvent>();
  events.onmessage = onEvent;
  return invoke("assistant_send", { chat, vault, text, shards, recent, events });
}

/**
 * Asks for a change to `selection` (Markdown) in `shard` (vault-relative),
 * streaming the Markdown that replaces it. `id` names the request, so
 * `stopChat(id)` stops it. Nothing is saved.
 */
export async function askInline(
  id: string,
  vault: string,
  shard: string,
  selection: string,
  whole: boolean,
  prompt: string,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const events = new Channel<ChatEvent>();
  events.onmessage = onEvent;
  await invoke("assistant_ask_inline", {
    id,
    vault,
    shard,
    selection,
    whole,
    prompt,
    events,
  });
}

export async function stopChat(chat: string): Promise<void> {
  await invoke("assistant_stop", { chat });
}

export async function listChats(): Promise<ChatInfo[]> {
  return invoke("assistant_chats");
}

/** Gives a new chat a short title from its first answer, and returns it. */
export async function retitleChat(chat: string): Promise<string> {
  return invoke("assistant_retitle", { chat });
}

export async function getChat(chat: string): Promise<ChatView> {
  return invoke("assistant_chat", { chat });
}

export async function deleteChat(chat: string): Promise<void> {
  await invoke("assistant_delete_chat", { chat });
}

export async function deleteAllChats(): Promise<void> {
  await invoke("assistant_delete_chats");
}

/** What the assistant remembers, kept on this computer. */
export interface AssistantMemory {
  items: string[];
  maxItems: number;
  /** The longest an item gets, in characters. */
  maxLength: number;
}

export async function getMemory(): Promise<AssistantMemory> {
  return invoke("assistant_memory");
}

export async function editMemory(
  item: string,
  text: string,
): Promise<AssistantMemory> {
  return invoke("assistant_memory_edit", { item, text });
}

export async function deleteMemory(item: string): Promise<AssistantMemory> {
  return invoke("assistant_memory_delete", { item });
}

export async function deleteAllMemory(): Promise<void> {
  await invoke("assistant_memory_delete_all");
}

/** Adds an item an answer offered to memory. */
export async function rememberOffer(offer: string): Promise<void> {
  await invoke("assistant_remember", { offer });
}

/** Takes an added item back out of memory. */
export async function forgetOffer(offer: string): Promise<void> {
  await invoke("assistant_forget", { offer });
}

export async function discardOffer(offer: string): Promise<void> {
  await invoke("assistant_discard_offer", { offer });
}
