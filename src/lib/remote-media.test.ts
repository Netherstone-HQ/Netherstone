import { describe, expect, it } from "vitest";

import { isRemoteAddress, remoteMediaIn, withRemoteMediaAsLinks } from "./remote-media";

const image = (url: string) => ({ type: "img", url, children: [{ text: "" }] });

describe("withRemoteMediaAsLinks", () => {
  it("shows media from the web as a link to its address", () => {
    const value = [
      { type: "p", children: [{ text: "Hi" }] },
      image("https://x.example/a.png?d=secret"),
      { type: "blockquote", children: [{ type: "media_embed", url: "//x.example/v", children: [{ text: "" }] }] },
    ];
    expect(withRemoteMediaAsLinks(value)).toEqual([
      value[0],
      {
        type: "p",
        children: [
          { text: "Image: " },
          { type: "a", url: "https://x.example/a.png?d=secret", children: [{ text: "https://x.example/a.png?d=secret" }] },
          { text: "" },
        ],
      },
      {
        type: "blockquote",
        children: [
          {
            type: "p",
            children: [
              { text: "Embed: " },
              { type: "a", url: "//x.example/v", children: [{ text: "//x.example/v" }] },
              { text: "" },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps vault files and media the shard already shows", () => {
    const vault = image("_attachments/map.png");
    const known = image("https://x.example/kept.png");
    expect(withRemoteMediaAsLinks([vault, known], remoteMediaIn([known]))).toEqual([vault, known]);
  });

  it("looks at every address a media block has", () => {
    const sneaky = { ...image("_attachments/a.png"), netherstoneRenderUrl: "https://x.example/a" };
    expect(withRemoteMediaAsLinks([sneaky])[0]).toMatchObject({ type: "p" });
  });
});

describe("isRemoteAddress", () => {
  it("is true for web addresses only", () => {
    expect(isRemoteAddress("HTTPS://x.example")).toBe(true);
    expect(isRemoteAddress(" //x.example/a")).toBe(true);
    expect(isRemoteAddress("_attachments/a.png")).toBe(false);
    expect(isRemoteAddress("data:image/png;base64,AA")).toBe(false);
    expect(isRemoteAddress(undefined)).toBe(false);
  });
});
