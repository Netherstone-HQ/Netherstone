import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ IS_ANDROID: false }));
vi.mock("@/lib/platform", () => platform);

import { bytesBody, toBase64 } from "./bytes";

const voice = new TextEncoder().encode("voice");

describe("bytesBody", () => {
  it("sends raw bytes where the webview can", () => {
    platform.IS_ANDROID = false;
    expect(bytesBody(voice)).toBe(voice);
  });

  it("sends base64 on Android", () => {
    platform.IS_ANDROID = true;
    expect(bytesBody(voice)).toEqual({ base64: "dm9pY2U=" });
  });
});

describe("toBase64", () => {
  it("encodes files larger than one chunk", () => {
    // Several 32 KB chunks, holding every byte value.
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256);
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (char) =>
      char.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
  });
});
