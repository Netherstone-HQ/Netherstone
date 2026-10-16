import { create } from "zustand";
import { getTaggedFiles, type TaggedFile } from "@/lib/tags";

interface TagsState {
  /** The vault `files` came from. */
  vaultPath: string | null;
  files: TaggedFile[];
  status: "idle" | "loading" | "ready" | "error";
  /** Set when the vault or its index changes, so the next visit reloads. */
  isStale: boolean;
  /** Null shows every tagged shard. Kept while you're in other modes. */
  selectedTag: string | null;
  filter: string;
  /**
   * Loads the vault's tagged shards unless they're already current, keeping
   * the last list on screen meanwhile.
   */
  load: (vaultPath: string) => Promise<void>;
  invalidate: () => void;
  selectTag: (tag: string | null) => void;
  setFilter: (filter: string) => void;
}

let latestLoad = 0;

export const useTagsStore = create<TagsState>()((set, get) => ({
  vaultPath: null,
  files: [],
  status: "idle",
  isStale: true,
  selectedTag: null,
  filter: "",
  load: async (vaultPath) => {
    const state = get();
    const isOtherVault = state.vaultPath !== vaultPath;
    if (!isOtherVault && !state.isStale) return;

    const request = ++latestLoad;
    // Cleared before the request, so a change while it runs marks it again.
    set(
      isOtherVault
        ? {
            vaultPath,
            files: [],
            status: "loading",
            isStale: false,
            selectedTag: null,
            filter: "",
          }
        : { isStale: false },
    );

    try {
      const files = await getTaggedFiles();
      if (request === latestLoad) set({ files, status: "ready" });
    } catch (error) {
      console.error("[Netherstone] Failed to load tags:", error);
      if (request === latestLoad) set({ status: "error", isStale: true });
    }
  },
  invalidate: () => set({ isStale: true }),
  selectTag: (tag) => set({ selectedTag: tag }),
  setFilter: (filter) => set({ filter }),
}));

/** The selected tag, or null (All tagged) once no shard uses it any more. */
export function selectActiveTag(state: TagsState) {
  const { selectedTag, files } = state;
  return selectedTag !== null &&
    files.some((file) => file.tags.some(({ tag }) => tag === selectedTag))
    ? selectedTag
    : null;
}
