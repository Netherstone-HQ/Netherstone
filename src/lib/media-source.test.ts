import { describe, expect, it } from "vitest";

import { getFilesystemPathFromMediaSource } from "@/lib/media-source";

const vaultPath = "/vaults/Notes";
const pathOf = (source: string) =>
  getFilesystemPathFromMediaSource(source, { vaultPath });

describe("vault attachment paths", () => {
  it("reads spaces written as %20, as other apps write them", () => {
    expect(pathOf("_attachments/My%20shot.png")).toBe(
      "/vaults/Notes/_attachments/My shot.png",
    );
    expect(pathOf("_attachments/Caf%C3%A9.png")).toBe(
      "/vaults/Notes/_attachments/Café.png",
    );
  });

  it("keeps a % that isn't an escape", () => {
    expect(pathOf("_attachments/100%.png")).toBe(
      "/vaults/Notes/_attachments/100%.png",
    );
    expect(pathOf("_attachments/100%%20off.png")).toBe(
      "/vaults/Notes/_attachments/100% off.png",
    );
  });

  it("reads the app's own paths as written", () => {
    expect(pathOf("_attachments/My shot.png")).toBe(
      "/vaults/Notes/_attachments/My shot.png",
    );
  });
});
