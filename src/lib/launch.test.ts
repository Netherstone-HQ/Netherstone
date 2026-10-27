// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { takeLaunch, type Launched } from "@/lib/commands";
import { useImportDialogStore } from "@/lib/import";
import { openLaunched, waitingText } from "@/lib/launch";
import { openVault } from "@/lib/open-vault";
import { useVaultStore } from "@/store";
import { toast } from "sonner";

vi.mock("@/lib/commands", () => ({ takeLaunch: vi.fn() }));
vi.mock("@/lib/nested-vault", () => ({ chooseVaultFolder: async (folder: string) => folder }));
vi.mock("@/lib/open-vault", () => ({
  folderName: (path: string) => path.split("/").pop(),
  openVault: vi.fn(async (path: string) => useVaultStore.setState({ currentVaultPath: path })),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }) }));

const launched = (taken: Partial<Launched>) =>
  vi.mocked(takeLaunch).mockResolvedValueOnce({ vault: null, files: [], waiting: [], ...taken });

describe("opening from outside the app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({ currentVaultPath: "/Vault" });
    useImportDialogStore.setState({ targetDir: null, job: null, files: null });
  });

  it("imports files into the open vault", async () => {
    launched({ files: ["/Downloads/Report.md"] });
    await openLaunched();
    expect(takeLaunch).toHaveBeenCalledWith(true);
    expect(useImportDialogStore.getState()).toMatchObject({ targetDir: "/Vault", files: ["/Downloads/Report.md"] });
  });

  it("opens a folder as the vault, then imports into it", async () => {
    launched({ vault: "/Other", files: ["/Downloads/Report.md"] });
    await openLaunched();
    expect(openVault).toHaveBeenCalledWith("/Other");
    expect(useImportDialogStore.getState().targetDir).toBe("/Other");
  });

  it("holds files while no vault is open, and says so", async () => {
    useVaultStore.setState({ currentVaultPath: null });
    launched({ waiting: ["Report.md"] });
    await openLaunched();
    expect(takeLaunch).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith("Open or create a vault to import Report.md", expect.anything());
    expect(useImportDialogStore.getState().targetDir).toBeNull();
  });

  it("holds files while another import runs", async () => {
    useImportDialogStore.setState({
      targetDir: "/Vault",
      job: { targetDir: "/Vault", step: { kind: "importing", progress: null }, cancel: () => {} },
    });
    launched({ waiting: ["Report.md"] });
    await openLaunched();
    expect(takeLaunch).toHaveBeenCalledWith(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("names what waits", () => {
    expect(waitingText(["a.md"])).toBe("a.md");
    expect(waitingText(["a.md", "b.pdf"])).toBe("a.md and b.pdf");
    expect(waitingText(["a.md", "b.pdf", "c.docx"])).toBe("3 files");
  });
});
