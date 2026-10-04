import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadMarkdown } from "@/test/markdown";

// The worker that autosave and note opening go through, driven through its
// message protocol.
const postMessage = vi.fn();
let send: (data: unknown) => unknown;

beforeAll(async () => {
  vi.stubGlobal("self", { postMessage });
  await import("./serialize.worker");
  send = (data) => {
    postMessage.mockClear();
    (self as any).onmessage({ data });
    return postMessage.mock.lastCall?.[0];
  };
});

const NOTE = "# Title\n\n- one\n- two\n\nValues <1 and {braces}.\n";

describe("markdown worker", () => {
  it("deserializes markdown into the same value as the main thread", () => {
    expect(
      send({ type: "deserialize", requestId: 1, filePath: "a.md", markdown: NOTE }),
    ).toEqual({
      type: "success",
      requestId: 1,
      filePath: "a.md",
      plateValue: loadMarkdown(NOTE),
    });
  });

  it("serializes what it deserialized back to the same markdown", () => {
    const { plateValue } = send({
      type: "deserialize",
      requestId: 2,
      markdown: NOTE,
    }) as { plateValue: unknown[] };

    expect(
      send({ type: "serialize", requestId: 3, filePath: "a.md", children: plateValue }),
    ).toEqual({
      type: "success",
      requestId: 3,
      filePath: "a.md",
      markdown: "# Title\n\n- one\n- two\n\nValues \\<1 and \\{braces}.\n",
    });
  });

  it("drops transient input nodes when saving", () => {
    const children = [
      {
        type: "p",
        children: [
          { text: "Hello " },
          { type: "slash_input", children: [{ text: "/" }] },
          { text: "world" },
        ],
      },
    ];

    expect(send({ type: "serialize", requestId: 4, children })).toMatchObject({
      type: "success",
      markdown: "Hello world\n",
    });
  });

  it("reports an unknown request as an error instead of throwing", () => {
    expect(send({ type: "bogus", requestId: 5 })).toMatchObject({
      type: "error",
      requestId: 5,
    });
  });
});
