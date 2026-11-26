import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_ANDROID: true,
}));

import { canOpenResolvedSource } from "./media-file-node";

describe("canOpenResolvedSource on a phone", () => {
  it("opens web links only, since phones have no desktop openers", () => {
    expect(canOpenResolvedSource({ kind: "remote" } as never)).toBe(true);
    for (const kind of ["vault", "local", "blob", "data", "unknown"]) {
      expect(canOpenResolvedSource({ kind } as never)).toBe(false);
    }
  });
});
