import { describe, expect, it } from "vitest";

import { chatWork, inlineWork } from "./companion-work";

const idle = { answering: null, ending: null, messages: [{}] };
const answering = (tool: string | null) => ({
  answering: { tool: tool ? { name: tool } : null },
  ending: null,
  messages: [{}],
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
