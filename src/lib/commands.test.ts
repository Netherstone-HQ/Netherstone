// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentSyncInfo } from "./commands";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const LIMIT = 20 * 1024 * 1024;
const pdf = {
  extension: "pdf",
  sizeBytes: 1_240_000,
  syncStatus: "syncable" as const,
  syncLimitBytes: LIMIT,
};
const exe = { ...pdf, extension: "exe", syncStatus: "blocked" as const };

beforeEach(() => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
});

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("attachmentSyncInfo", () => {
  it("asks once for every file a shard shows", async () => {
    vi.mocked(invoke).mockResolvedValue([pdf, exe, null]);

    const infos = await Promise.all([
      attachmentSyncInfo("C:/Vault", "_attachments/a.pdf"),
      attachmentSyncInfo("C:/Vault", "_attachments/setup.exe"),
      attachmentSyncInfo("C:/Vault", "_attachments/a.pdf"),
      attachmentSyncInfo("C:/Vault", "_attachments/gone.png"),
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("attachment_sync_infos", {
      vaultPath: "C:/Vault",
      assetPaths: [
        "_attachments/a.pdf",
        "_attachments/setup.exe",
        "_attachments/gone.png",
      ],
    });
    expect(infos).toEqual([pdf, exe, pdf, null]);
  });

  it("asks again for files shown later", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([pdf]).mockResolvedValueOnce([exe]);

    await attachmentSyncInfo("C:/Vault", "_attachments/a.pdf");
    const later = await attachmentSyncInfo("C:/Vault", "_attachments/a.pdf");

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(later).toEqual(exe);
  });

  it("fails every ask in a call that fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Not the open vault"));

    const asks = [
      attachmentSyncInfo("C:/Other", "_attachments/a.pdf"),
      attachmentSyncInfo("C:/Other", "_attachments/b.pdf"),
    ];

    for (const ask of asks) {
      await expect(ask).rejects.toThrow("Not the open vault");
    }
  });
});
