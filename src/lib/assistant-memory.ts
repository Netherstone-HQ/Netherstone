import { toast } from "sonner";

import { busy } from "@/lib/assistant-changes";
import {
  type ChatMemory,
  discardOffer,
  forgetOffer,
  getChat,
  rememberOffer,
} from "@/lib/commands";
import { useAssistantStore } from "@/store/assistant";

const store = useAssistantStore;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the chat's memory items again, as Apply or Undo left them. */
async function reloadMemories(chat: string) {
  const view = await getChat(chat);
  if (store.getState().chat?.id === chat) {
    store.setState({ memories: view.memories });
  }
}

/** Adds an item an answer offered to memory. */
export function applyMemory(memory: ChatMemory) {
  const chat = store.getState().chat?.id;
  if (!chat) return Promise.resolve();
  return busy(memory, async () => {
    try {
      await rememberOffer(memory.id);
    } catch (error) {
      console.error("[Netherstone] Couldn't add to memory:", error);
      toast.error("Couldn't add to memory", { description: errorText(error) });
    }
    await reloadMemories(chat).catch(() => {});
  });
}

/** Takes an added item back out of memory. */
export function undoMemory(memory: ChatMemory) {
  const chat = store.getState().chat?.id;
  if (!chat) return Promise.resolve();
  return busy(memory, async () => {
    try {
      await forgetOffer(memory.id);
    } catch (error) {
      console.error("[Netherstone] Couldn't take it out of memory:", error);
      toast.error("Couldn't take it out of memory", {
        description: errorText(error),
      });
    }
    await reloadMemories(chat).catch(() => {});
  });
}

/** Drops an offered item without adding it. */
export function discardMemory(memory: ChatMemory) {
  return busy(memory, async () => {
    try {
      await discardOffer(memory.id);
    } catch (error) {
      // The card stays, as the item is still offered.
      console.error("[Netherstone] Couldn't discard a memory item:", error);
      toast.error("Couldn't discard it", { description: errorText(error) });
      return;
    }
    store.setState({
      memories: store.getState().memories.filter((m) => m.id !== memory.id),
    });
  });
}
