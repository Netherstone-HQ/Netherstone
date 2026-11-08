// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { fileExists } from "@/lib/commands/attachments";
import { openVaultFile } from "@/lib/open-vault-file";
import {
  endRecentCycle,
  openRecentFile,
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

vi.mock("@/lib/commands/attachments", () => ({
  fileExists: vi.fn(async () => true),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const entry = (name: string) => ({ path: `C:/Vault/${name}`, name });
const opened = () => vi.mocked(openVaultFile).mock.calls.map(([path]) => path);
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
    vi.mocked(fileExists).mockImplementation(async () => true);
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
    for (let i = 0; i < 3; i++) await stepRecentFile(1);
    expect(opened()).toEqual([
      "C:/Vault/B.md",
      "C:/Vault/C.md",
      "C:/Vault/A.md",
    ]);
  });

  it("goes up Recent with Shift", async () => {
    await stepRecentFile(-1);
    expect(opened()).toEqual(["C:/Vault/C.md"]);
  });

  it("starts again from the top once Ctrl is let go", async () => {
    await stepRecentFile(1);
    endRecentCycle();
    await stepRecentFile(1);
    expect(opened()).toEqual(["C:/Vault/B.md", "C:/Vault/A.md"]);
  });

  it("opens only the last of quick presses once the first is done", async () => {
    void stepRecentFile(1);
    void stepRecentFile(1);
    await stepRecentFile(1);
    expect(opened()).toEqual(["C:/Vault/B.md", "C:/Vault/A.md"]);
  });

  it("leaves a file that's gone out of the steps after it", async () => {
    vi.mocked(fileExists).mockImplementation(async (path) => path !== "C:/Vault/B.md");
    await stepRecentFile(1);
    await stepRecentFile(1);
    await stepRecentFile(1);
    await stepRecentFile(1);
    expect(opened()).toEqual(["C:/Vault/C.md", "C:/Vault/A.md", "C:/Vault/C.md"]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Recent is off", async () => {
    useSettingsStore.setState({ showRecentFiles: false });
    await stepRecentFile(1);
    expect(openVaultFile).not.toHaveBeenCalled();
  });
});

describe("openRecentFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({
      recentFiles: ["A.md", "B.md"].map(entry),
      pinnedFiles: [entry("B.md")],
    });
  });

  it("takes a file that's gone off Recent, and says so", async () => {
    vi.mocked(fileExists).mockResolvedValueOnce(false);
    await openRecentFile("C:/Vault/B.md");
    expect(openVaultFile).not.toHaveBeenCalled();
    expect(useUIStore.getState().recentFiles).toEqual([entry("A.md")]);
    // Only Recent: Pinned is the user's own list.
    expect(useUIStore.getState().pinnedFiles).toEqual([entry("B.md")]);
    expect(toast.error).toHaveBeenCalledWith("Couldn't find B", {
      description: "It's no longer in this vault, so Recent doesn't list it.",
    });
  });

  it("opens a file that's there", async () => {
    await openRecentFile("C:/Vault/A.md");
    expect(openVaultFile).toHaveBeenCalledWith("C:/Vault/A.md");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
