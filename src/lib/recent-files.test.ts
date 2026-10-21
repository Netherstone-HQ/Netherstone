// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openVaultFile } from "@/lib/open-vault-file";
import {
  endRecentCycle,
  shownRecentFiles,
  stepRecentFile,
} from "@/lib/recent-files";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

vi.mock("@/lib/open-vault-file", () => ({
  openVaultFile: vi.fn(async (path: string) => {
    useEditorStore.setState({ currentFilePath: path });
    useUIStore.getState().pushRecentFile({ path, name: path });
  }),
}));

const entry = (name: string) => ({ path: `C:/Vault/${name}`, name });
const opened = () => vi.mocked(openVaultFile).mock.calls.map(([path]) => path);
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("shownRecentFiles", () => {
  const files = [
    entry("A.md"),
    { path: "C:/Other/B.md", name: "B.md" },
    entry("C.md"),
    entry("D.md"),
  ];

  it("keeps the vault's files, up to the count", () => {
    expect(shownRecentFiles(files, "C:/Vault", true, 2)).toEqual([
      entry("A.md"),
      entry("C.md"),
    ]);
  });

  it("is empty when Recent is off", () => {
    expect(shownRecentFiles(files, "C:/Vault", false, 20)).toEqual([]);
  });
});

describe("stepRecentFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endRecentCycle();
    useVaultStore.getState().setCurrentVaultPath("C:/Vault");
    useSettingsStore.setState({ showRecentFiles: true, recentFilesLimit: 3 });
    useUIStore.setState({
      appMode: "notes",
      recentFiles: ["A.md", "B.md", "C.md", "D.md"].map(entry),
    });
    useEditorStore.setState({ currentFilePath: "C:/Vault/A.md" });
  });

  it("goes down Recent while Ctrl is held, and around", async () => {
    for (let i = 0; i < 3; i++) {
      stepRecentFile(1);
      await settle();
    }
    expect(opened()).toEqual([
      "C:/Vault/B.md",
      "C:/Vault/C.md",
      "C:/Vault/A.md",
    ]);
  });

  it("goes up Recent with Shift", async () => {
    stepRecentFile(-1);
    await settle();
    expect(opened()).toEqual(["C:/Vault/C.md"]);
  });

  it("starts again from the top once Ctrl is let go", async () => {
    stepRecentFile(1);
    await settle();
    endRecentCycle();
    stepRecentFile(1);
    await settle();
    expect(opened()).toEqual(["C:/Vault/B.md", "C:/Vault/A.md"]);
  });

  it("opens only the last of quick presses once the first is done", async () => {
    stepRecentFile(1);
    stepRecentFile(1);
    stepRecentFile(1);
    await settle();
    expect(opened()).toEqual(["C:/Vault/B.md", "C:/Vault/A.md"]);
  });

  it("does nothing when Recent is off", async () => {
    useSettingsStore.setState({ showRecentFiles: false });
    stepRecentFile(1);
    await settle();
    expect(openVaultFile).not.toHaveBeenCalled();
  });
});
