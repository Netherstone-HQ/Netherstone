// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useShardScrollStore } from "./shard-scroll";

const store = () => useShardScrollStore.getState();

beforeEach(() => {
  useShardScrollStore.setState({ positions: {} });
});

describe("shard scroll positions", () => {
  it("remembers a place per shard, whichever separator the path uses", () => {
    store().setPosition("C:\\vault\\a.md", { block: 12, offset: 30 });
    store().setPosition("C:/vault/b.md", { block: 3, offset: 0 });

    expect(store().getPosition("C:/vault/a.md")).toEqual({
      block: 12,
      offset: 30,
    });
    expect(store().getPosition("C:\\vault\\b.md")).toEqual({
      block: 3,
      offset: 0,
    });
    expect(store().getPosition("C:/vault/c.md")).toBeNull();
  });

  it("follows a shard, or the folder it's in, when renamed or moved", () => {
    store().setPosition("/v/notes/a.md", { block: 5, offset: 0 });
    store().setPosition("/v/other.md", { block: 7, offset: 0 });

    store().remapPositions("/v/notes", "/v/archive");
    store().remapPositions("/v/other.md", "/v/renamed.md");

    expect(store().getPosition("/v/archive/a.md")?.block).toBe(5);
    expect(store().getPosition("/v/notes/a.md")).toBeNull();
    expect(store().getPosition("/v/renamed.md")?.block).toBe(7);
  });

  it("forgets the shards in a removed folder", () => {
    store().setPosition("/v/notes/a.md", { block: 5, offset: 0 });
    store().setPosition("/v/kept.md", { block: 1, offset: 0 });

    store().forgetPositions("/v/notes");

    expect(store().getPosition("/v/notes/a.md")).toBeNull();
    expect(store().getPosition("/v/kept.md")?.block).toBe(1);
  });

  it("keeps the 500 most recently read shards", () => {
    for (let i = 0; i < 501; i += 1) {
      useShardScrollStore.setState((state) => ({
        positions: {
          ...state.positions,
          [`/v/${i}.md`]: { block: i, offset: 0, at: i },
        },
      }));
    }
    store().setPosition("/v/new.md", { block: 1, offset: 0 });

    expect(Object.keys(store().positions)).toHaveLength(500);
    expect(store().getPosition("/v/0.md")).toBeNull();
    expect(store().getPosition("/v/1.md")).toBeNull();
    expect(store().getPosition("/v/new.md")).not.toBeNull();
  });
});
