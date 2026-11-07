import { useCallback, useEffect, useState } from "react";

import {
  type AssistantStatus,
  type ChatError,
  type LocalServer,
  type PickedModel,
  findLocalServerDown,
  getAssistantStatus,
  getPickedModel,
  listMcpVaults,
} from "@/lib/commands";
import { isSamePath } from "@/lib/drawing-files";
import type { Ending } from "@/store/assistant";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

import { shardName } from "./Composer";
import { SERVER_NAMES, isSetUp } from "./models";

/** What a chat needs before it can start. */
export interface Setup {
  status: AssistantStatus;
  picked: PickedModel | null;
  /** Whether the open vault is on for AI. */
  vaultAllowed: boolean;
  /** The picked model's local server, when it isn't answering. */
  serverDown: LocalServer["kind"] | null;
}

export type SetupState =
  | "loading"
  | "noProvider"
  | "vaultOff"
  | "noModel"
  | "serverDown"
  | "ready";

export function setupState(setup: Setup | null): SetupState {
  if (!setup) return "loading";
  if (!setup.status.providers.some(isSetUp)) return "noProvider";
  if (!setup.vaultAllowed) return "vaultOff";
  if (!setup.picked) return "noModel";
  if (setup.serverDown) return "serverDown";
  return "ready";
}

/** What the setup says when the picked model's local server isn't answering. */
export function serverDownText(kind: LocalServer["kind"]) {
  return `${SERVER_NAMES[kind] ?? "The local server"} isn't running`;
}

/** Read while `active`, and again on leaving Settings. */
export function useSetup(active = true) {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const inSettings = useUIStore((s) => s.activeNavItem === "settings");
  const [setup, setSetup] = useState<Setup | null>(null);

  const load = useCallback(async () => {
    try {
      const [status, picked, vaults] = await Promise.all([
        getAssistantStatus(),
        getPickedModel().catch(() => null),
        listMcpVaults(),
      ]);
      const vaultAllowed =
        vault !== null &&
        vaults.some((v) => v.allowed && isSamePath(v.path, vault));
      // Asked only for a local model, so the probe stays off otherwise.
      const serverDown =
        status.enabled && picked?.local ? await findLocalServerDown() : null;
      setSetup({ status, picked, vaultAllowed, serverDown });
    } catch (error) {
      console.error("[Netherstone] Couldn't read the assistant's setup:", error);
    }
  }, [vault]);

  useEffect(() => {
    if (active && !inSettings) void load();
  }, [load, active, inSettings]);

  return { setup, reload: load };
}

const ERRORS: Record<ChatError["kind"], string> = {
  keyRefused: "The provider turned down the key",
  unreachable: "Couldn't reach the provider",
  rateLimited: "The provider is getting too many requests, try again soon",
  busy: "The provider is busy, try again soon",
  timedOut: "The provider stopped answering",
  tooLong: "This chat is longer than the model can read, start a new one",
  contextTooSmall:
    "This model's context is too small for the assistant's instructions and tools",
  failed: "The provider couldn't answer",
  stopped: "Stopped",
  noModel: "No model picked",
  turnedOff: "The assistant is off",
  vaultClosed: "This vault is off for AI",
  answering: "This chat is still answering",
  noChat: "This chat was deleted",
  storage: "Couldn't save the chat",
};

/** What an answer that didn't end well says under it. */
export function endingText(ending: Ending) {
  switch (ending.kind) {
    case "error":
      return ERRORS[ending.error];
    case "stop":
      return ending.stop === "length"
        ? "The answer reached the model's length limit"
        : "The provider held the answer back";
    case "stepLimit":
      return "Stopped after too many steps";
    case "stopped":
      return "Stopped";
  }
}

/** What a tool the model runs is doing, as the assistant says it. */
function activity(tool: { name: string; paths: string[] }) {
  const name = tool.paths[0] ? shardName(tool.paths[0]) : null;
  switch (tool.name) {
    case "search":
      return "Searching the vault";
    case "read":
      return name ? `Reading ${name}` : "Reading";
    case "read_drawing":
      return name ? `Looking at ${name}` : "Looking at a drawing";
    case "list_folder":
      return name ? `Looking in ${name}` : "Looking through folders";
    case "links":
      return "Following links";
    case "list_tags":
      return "Looking at tags";
    case "vault_overview":
      return "Looking over the vault";
    case "edit_shard":
      return name ? `Changing ${name}` : "Changing a shard";
    case "create_shard":
      return "Making a shard";
    case "move":
      return name ? `Moving ${name}` : "Moving";
    case "edit_drawing":
      return name ? `Drawing in ${name}` : "Drawing";
    default:
      return "Working";
  }
}

/** What an answer coming in says while there's no text to show. */
export function waitingText(answering: {
  text: string;
  reasoning: string;
  tool: { name: string; paths: string[] } | null;
}) {
  if (answering.tool) return activity(answering.tool);
  return answering.reasoning ? "Thinking" : "Waiting for the answer";
}
