// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importShard, scanVault } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import {
  importOutsideShard,
  openOutsideShardVault,
  openShardFile,
  useOutsideShard,
} from "@/lib/open-shard-file";
import { openVault } from "@/lib/open-vault";
import { useVaultStore } from "@/store";

vi.mock("@/lib/commands", () => ({
  importShard: vi.fn(async () => "C:/Vault/Copied.md"),
  scanVault: vi.fn(async () => []),
}));

vi.mock("@/lib/open-editor-file", () => ({ openEditorFile: vi.fn() }));

vi.mock("@/lib/open-vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/open-vault")>()),
  openVault: vi.fn(async (path: string) =>
    useVaultStore.getState().setCurrentVaultPath(path),
  ),
}));

const pending = () => useOutsideShard.getState().shard;

describe("openShardFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOutsideShard.setState({ shard: null });
    useVaultStore.getState().setCurrentVaultPath("C:/Vault");
  });

  it("opens a shard in the open vault", async () => {
    await openShardFile("C:/Vault/Work/Plan.md");
    expect(openEditorFile).toHaveBeenCalledWith("C:/Vault/Work/Plan.md");
    expect(pending()).toBeNull();
  });

  it("opens the shard's folder as the vault when none is open", async () => {
    useVaultStore.getState().setCurrentVaultPath(null);
    await openShardFile("C:\\Notes\\Plan.md");
    expect(openVault).toHaveBeenCalledWith("C:\\Notes");
    expect(openEditorFile).toHaveBeenCalledWith("C:\\Notes\\Plan.md");
  });

  it("asks about a shard from outside the open vault", async () => {
    await openShardFile("C:/Notes/Plan.md");
    expect(openEditorFile).not.toHaveBeenCalled();
    expect(pending()).toEqual({
      filePath: "C:/Notes/Plan.md",
      vaultPath: "C:/Notes",
    });
  });

  it("copies the shard into the vault and opens the copy", async () => {
    await openShardFile("C:/Notes/Plan.md");
    await importOutsideShard();
    expect(importShard).toHaveBeenCalledWith("C:/Notes/Plan.md", "C:/Vault");
    expect(scanVault).toHaveBeenCalledWith("C:/Vault");
    expect(openEditorFile).toHaveBeenCalledWith("C:/Vault/Copied.md");
    expect(pending()).toBeNull();
  });

  it("switches to the shard's folder and opens it there", async () => {
    await openShardFile("C:/Notes/Plan.md");
    await openOutsideShardVault();
    expect(openVault).toHaveBeenCalledWith("C:/Notes");
    expect(openEditorFile).toHaveBeenCalledWith("C:/Notes/Plan.md");
    expect(pending()).toBeNull();
  });
});
