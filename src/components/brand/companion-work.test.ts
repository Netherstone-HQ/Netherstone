import { describe, expect, it } from "vitest";

import { changedFiles, chatWork, discarded, inlineWork } from "./companion-work";

const CHAT = { id: "chat-1" };
const idle = { chat: CHAT, answering: null, ending: null, messages: [{}], changes: [] };
const answering = (tool: string | null) => ({
  ...idle,
  answering: { tool: tool ? { name: tool } : null },
});

describe("chatWork", () => {
  it("searches while the vault is searched, and reads otherwise", () => {
    expect(chatWork(idle, answering(null))).toBe("read");
    expect(chatWork(answering(null), answering("search"))).toBe("search");
    expect(chatWork(answering("search"), answering("read"))).toBe("read");
    expect(chatWork(answering("read"), answering("edit_shard"))).toBe("read");
  });

  it("is done when the answer lands, and shrugs when it fails", () => {
    expect(chatWork(answering("read"), idle)).toBe("done");
    expect(
      chatWork(answering(null), { ...idle, ending: { kind: "error" } }),
    ).toBe("shrug");
    expect(
      chatWork(answering(null), { ...idle, ending: { kind: "stopped" } }),
    ).toBe("idle");
  });

  it("goes back to idle when a new chat replaces the answer", () => {
    expect(chatWork(answering("read"), { ...idle, messages: [] })).toBe("idle");
  });

  it("changes nothing while no answer is coming", () => {
    expect(chatWork(idle, idle)).toBeNull();
  });
});

describe("inlineWork", () => {
  it("reads while the answer comes, and is done when the preview shows", () => {
    expect(inlineWork("prompt", "working")).toBe("read");
    expect(inlineWork("working", "preview")).toBe("done");
  });

  it("shrugs when the answer fails, and idles when it's stopped", () => {
    expect(inlineWork("working", "prompt")).toBe("shrug");
    expect(inlineWork("working", null)).toBe("idle");
  });

  it("changes nothing outside an answer", () => {
    expect(inlineWork(null, "prompt")).toBeNull();
    expect(inlineWork("preview", null)).toBeNull();
    expect(inlineWork("prompt", "prompt")).toBeNull();
  });
});

describe("changedFiles", () => {
  const tool = (name: string, paths: string[]) => ({
    ...idle,
    answering: { tool: { name, paths } },
  });

  it("counts each file the answer changes once", () => {
    let changed = changedFiles([], idle, tool("read", ["A.md"]));
    expect(changed).toEqual([]);
    let previous = tool("edit_shard", ["A.md"]);
    changed = changedFiles(changed, tool("read", ["A.md"]), previous);
    expect(changed).toEqual(["A.md"]);
    const again = tool("edit_shard", ["A.md"]);
    changed = changedFiles(changed, previous, again);
    expect(changed).toEqual(["A.md"]);
    previous = again;
    changed = changedFiles(changed, previous, tool("move", ["B.md", "C.md"]));
    expect(changed).toEqual(["A.md", "B.md"]);
  });

  it("counts every new shard, even in one folder", () => {
    const first = tool("create_shard", ["Notes"]);
    const one = changedFiles([], answering(null), first);
    expect(changedFiles(one, first, tool("create_shard", ["Notes"]))).toHaveLength(2);
  });

  it("keeps the count once the answer ends, and starts again with each new message", () => {
    expect(changedFiles(["A.md", "B.md"], tool("edit_shard", ["B.md"]), idle)).toEqual(["A.md", "B.md"]);
    const sent = { ...idle, messages: [{}, {}] };
    expect(changedFiles(["A.md"], idle, { ...tool("edit_shard", ["B.md"]), messages: [{}, {}] })).toEqual(["B.md"]);
    expect(changedFiles(["A.md"], sent, { ...sent, answering: { tool: null } })).toEqual([]);
  });

  it("carries on counting when Try again goes on after an error", () => {
    const failed = { ...idle, ending: { kind: "error" } };
    expect(changedFiles(["A.md"], failed, tool("edit_shard", ["B.md"]))).toEqual(["A.md", "B.md"]);
    // Not in another chat.
    const other = { ...tool("edit_shard", ["B.md"]), chat: { id: "chat-2" } };
    expect(changedFiles(["A.md"], failed, other)).toEqual(["B.md"]);
  });
});

describe("discarded", () => {
  const changes = (...states: [number, string][]) => ({
    ...idle,
    changes: states.map(([turn, state], i) => ({ id: `c${i}`, turn, state })),
  });

  it("is true when a pending change from the last answer is discarded", () => {
    expect(discarded(changes([1, "pending"]), changes([1, "discarded"]))).toBe(true);
    expect(discarded(changes([1, "applied"]), changes([1, "applied"]))).toBe(false);
    expect(discarded(changes([1, "discarded"]), changes([1, "discarded"]))).toBe(false);
    expect(discarded(idle, changes([1, "discarded"]))).toBe(false);
  });

  it("leaves out an earlier answer's change, and anything while an answer comes", () => {
    expect(discarded(changes([1, "pending"], [2, "pending"]), changes([1, "discarded"], [2, "pending"]))).toBe(false);
    const coming = { ...changes([1, "discarded"]), answering: { tool: null } };
    expect(discarded(changes([1, "pending"]), coming)).toBe(false);
  });
});
