// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentSyncInfo, openFile } from "./attachments";

const phone = vi.hoisted(() => ({ openFile: vi.fn() }));
let onPhone = false;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/android-bridge", () => ({ androidBridge: () => (onPhone ? phone : undefined) }));

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
  onPhone = false;
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

  it("fails as a promise outside the app", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");

    const ask = attachmentSyncInfo("C:/Vault", "_attachments/a.pdf");

    await expect(ask).rejects.toThrow("Tauri internals not found");
    expect(invoke).not.toHaveBeenCalled();
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

describe("openFile", () => {
  it("opens with the computer's app", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await openFile("C:/Vault/_attachments/a.pdf");
    expect(invoke).toHaveBeenCalledWith("open_file", { path: "C:/Vault/_attachments/a.pdf" });
  });

  it("hands the file to another app on a phone, and says why it couldn't", async () => {
    onPhone = true;
    phone.openFile.mockResolvedValueOnce("opened");
    await expect(openFile("/Vaults/V/a.pdf")).resolves.toBeUndefined();
    phone.openFile.mockResolvedValueOnce("no-app");
    await expect(openFile("/Vaults/V/a.xyz")).rejects.toThrow("No app on this phone");
    phone.openFile.mockResolvedValueOnce("not-allowed");
    await expect(openFile("/Vaults/V/a.apk")).rejects.toThrow("can't hand this file");
    expect(invoke).not.toHaveBeenCalled();
  });
});
