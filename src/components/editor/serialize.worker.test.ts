import { beforeAll, describe, expect, it, vi } from "vitest";
import { KEYS } from "platejs";
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

  it("makes the cache entry for a save: the markdown, then the value", () => {
    const children = [{ type: "p", children: [{ text: "Héllo" }] }];
    const { markdown, cache } = send({
      type: "serialize",
      requestId: 4,
      children,
      withCache: true,
    }) as { markdown: string; cache: { body: Uint8Array; markdownBytes: number } };

    const split = new TextEncoder().encode(markdown).length;
    expect(cache.markdownBytes).toBe(split);
    expect(new TextDecoder().decode(cache.body.slice(0, split))).toBe(markdown);
    expect(JSON.parse(new TextDecoder().decode(cache.body.slice(split)))).toEqual(
      children,
    );
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

  it("writes every mark the same way on every save", () => {
    // Highlight and kbd have no plugin in this editor.
    const children = [
      {
        type: KEYS.p,
        children: [
          { text: "a", [KEYS.bold]: true, [KEYS.italic]: true },
          { text: " b", [KEYS.underline]: true },
          { text: " c", [KEYS.highlight]: true },
          { text: " d", [KEYS.kbd]: true },
          { text: " e", [KEYS.sub]: true },
          { text: " f", [KEYS.sup]: true },
          { text: " g", [KEYS.strikethrough]: true, [KEYS.code]: true },
          { text: " h", [KEYS.color]: "#ff0000" },
        ],
      },
    ];
    const markdown =
      '_**a**_ <u>b</u> <mark>c</mark> <kbd>d</kbd> <sub>e</sub> <sup>f</sup>~~` g`~~ <span style="color: #ff0000;">h</span>\n';

    for (const requestId of [6, 7]) {
      expect(send({ type: "serialize", requestId, children })).toMatchObject({
        type: "success",
        markdown,
      });
    }
  });

  it("reports an unknown request as an error instead of throwing", () => {
    expect(send({ type: "bogus", requestId: 5 })).toMatchObject({
      type: "error",
      requestId: 5,
    });
  });
});
