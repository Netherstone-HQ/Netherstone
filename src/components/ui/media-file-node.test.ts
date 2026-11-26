import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_ANDROID: true,
}));

import { canOpenResolvedSource } from "./media-file-node";

describe("canOpenResolvedSource on a phone", () => {
  it("opens web links and files on the phone", () => {
    for (const kind of ["remote", "vault", "local"]) {
      expect(canOpenResolvedSource({ kind } as never)).toBe(true);
    }
    for (const kind of ["blob", "data", "unknown"]) {
      expect(canOpenResolvedSource({ kind } as never)).toBe(false);
    }
  });
});
