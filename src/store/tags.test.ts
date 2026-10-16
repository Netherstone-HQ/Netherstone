import { beforeEach, describe, expect, it, vi } from "vitest";

const getTaggedFiles = vi.fn();
vi.mock("@/lib/tags", () => ({ getTaggedFiles: () => getTaggedFiles() }));

const { useTagsStore, selectActiveTag } = await import("./tags");

const shard = (name: string, ...tags: string[]) => ({
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  last_modified: 0,
  tags: tags.map((tag) => ({ tag, excerpt: null })),
});

describe("useTagsStore", () => {
  beforeEach(() => {
    getTaggedFiles.mockReset().mockResolvedValue([shard("a", "ideas")]);
    useTagsStore.setState({
      vaultPath: null,
      files: [],
      status: "idle",
      isStale: true,
      selectedTag: null,
      filter: "",
    });
  });

  it("loads once, then again only after the index changes", async () => {
    const { load, invalidate } = useTagsStore.getState();

    await load("/vault");
    await load("/vault");
    expect(getTaggedFiles).toHaveBeenCalledTimes(1);
    expect(useTagsStore.getState().status).toBe("ready");

    invalidate();
    await load("/vault");
    expect(getTaggedFiles).toHaveBeenCalledTimes(2);
  });

  it("starts over in another vault", async () => {
    const { load, selectTag, setFilter } = useTagsStore.getState();
    await load("/vault");
    selectTag("ideas");
    setFilter("id");

    await load("/other");
    expect(getTaggedFiles).toHaveBeenCalledTimes(2);
    expect(useTagsStore.getState()).toMatchObject({
      vaultPath: "/other",
      selectedTag: null,
      filter: "",
    });
  });

  it("tries again on the next visit after a failure", async () => {
    getTaggedFiles.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { load } = useTagsStore.getState();

    await load("/vault");
    expect(useTagsStore.getState().status).toBe("error");
    await load("/vault");
    expect(useTagsStore.getState().status).toBe("ready");
  });

  it("falls back to All tagged when the selected tag is gone", async () => {
    const { load, selectTag } = useTagsStore.getState();
    await load("/vault");

    selectTag("ideas");
    expect(selectActiveTag(useTagsStore.getState())).toBe("ideas");
    selectTag("removed");
    expect(selectActiveTag(useTagsStore.getState())).toBeNull();
  });
});
