// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openEditorFile } from "@/lib/open-editor-file";
import { openFileHistory, openVaultFile } from "@/lib/open-vault-file";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { useUIStore } from "@/store/ui";

vi.mock("@/lib/open-editor-file", () => ({ openEditorFile: vi.fn() }));

describe("openVaultFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      currentFilePath: "C:/Vault/Plan.md",
      openingFilePath: null,
    });
    useHistoryStore.getState().closeHistory();
    useUIStore.setState({ appMode: "tags" });
  });

  it("opens another shard", async () => {
    await openVaultFile("C:/Vault/Notes.md");
    expect(openEditorFile).toHaveBeenCalledWith("C:/Vault/Notes.md");
    expect(useUIStore.getState().appMode).toBe("notes");
  });

  it("leaves the open shard as it is", async () => {
    await openVaultFile("C:\\Vault\\Plan.md");
    expect(openEditorFile).not.toHaveBeenCalled();
    expect(useUIStore.getState().appMode).toBe("notes");
  });

  it("doesn't open a shard again while it's opening", async () => {
    useEditorStore.setState({ openingFilePath: "C:/Vault/Notes.md" });
    await openVaultFile("C:/Vault/Notes.md");
    expect(openEditorFile).not.toHaveBeenCalled();
  });

  it("opens the shard on screen when another is opening", async () => {
    useEditorStore.setState({ openingFilePath: "C:/Vault/Notes.md" });
    await openVaultFile("C:/Vault/Plan.md");
    expect(openEditorFile).toHaveBeenCalledWith("C:/Vault/Plan.md");
  });

  it("leaves a deleted shard's history for the open shard", async () => {
    useHistoryStore.getState().openDeletedHistory("C:/Vault/Gone.md");
    await openVaultFile("C:/Vault/Plan.md");
    expect(useHistoryStore.getState().deletedPath).toBeNull();
  });

  it("shows the open shard's history without opening it again", async () => {
    await openFileHistory("C:/Vault/Plan.md");
    expect(openEditorFile).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().openIn).toBe("notes");
  });
});
