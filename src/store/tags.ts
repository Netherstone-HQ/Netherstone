import { create } from "zustand";
import { getTaggedFiles, type TaggedFile } from "@/lib/tags";

interface TagsState {
  /** The vault `files` came from. */
  vaultPath: string | null;
  files: TaggedFile[];
  status: "idle" | "loading" | "ready" | "error";
  /** Null shows every tagged shard. Kept while you're in other modes. */
  selectedTag: string | null;
  filter: string;
  /** Loads the vault's tagged shards, keeping the last list on screen meanwhile. */
  load: (vaultPath: string) => Promise<void>;
  selectTag: (tag: string | null) => void;
  setFilter: (filter: string) => void;
}

let latestLoad = 0;

export const useTagsStore = create<TagsState>()((set, get) => ({
  vaultPath: null,
  files: [],
  status: "idle",
  selectedTag: null,
  filter: "",
  load: async (vaultPath) => {
    const request = ++latestLoad;
    if (get().vaultPath !== vaultPath) {
      set({
        vaultPath,
        files: [],
        status: "loading",
        selectedTag: null,
        filter: "",
      });
    }

    try {
      const files = await getTaggedFiles();
      if (request === latestLoad) set({ files, status: "ready" });
    } catch (error) {
      console.error("[Netherstone] Failed to load tags:", error);
      if (request === latestLoad) set({ status: "error" });
    }
  },
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
