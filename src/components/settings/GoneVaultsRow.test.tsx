// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetGoneVaults, type GoneVaultHistory } from "@/lib/gone-vaults";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { GoneVaultsRow } from "./GoneVaultsRow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const GONE: GoneVaultHistory[] = [
  { vaultId: "a1", name: "Test", path: "C:/Test", sizeBytes: 3 * 1024 * 1024 },
  { vaultId: "b2", name: "Old", path: "C:/Old", sizeBytes: 1024 * 1024 },
];

function Row() {
  const [histories, setHistories] = useState(GONE);
  return <GoneVaultsRow histories={histories} onChange={setHistories} />;
}

describe("GoneVaultsRow", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  afterEach(cleanup);

  it("moves only the histories picked to the trash", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "delete_gone_vault_history") return 1024 * 1024;
      if (command === "gone_vault_histories") return [GONE[0]];
      return undefined;
    });
    render(<Row />);
    expect(screen.getByText("Their history takes 4.0 MB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete history" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Move to trash",
    )!;
    // Nothing is picked until the person picks it.
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText("Delete history?")).toBeTruthy();
    // Vaults with the same name are told apart by where they were.
    expect(screen.getByText("C:/Old")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("Delete 1.0 MB of history?")).toBeTruthy();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("delete_gone_vault_history", {
        vaultId: "b2",
      }),
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Their history takes 3.0 MB")).toBeTruthy();
  });

  it("forgets the recent vaults and files of vaults that are gone", async () => {
    useVaultStore.setState({ recentVaults: ["C:/Kept", "C:/Test"] });
    useUIStore.setState({
      recentFiles: [
        { path: "C:/Kept/a.md", name: "a.md" },
        { path: "C:/Test/b.md", name: "b.md" },
      ],
      pinnedFiles: [{ path: "C:/Test/c.md", name: "c.md" }],
      openFolders: ["C:/Test/Work"],
    });
    vi.mocked(invoke).mockResolvedValue(["C:/Test"]);

    await forgetGoneVaults();

    expect(invoke).toHaveBeenCalledWith("forget_gone_vaults", {
      recent: ["C:/Kept", "C:/Test"],
    });
    expect(useVaultStore.getState().recentVaults).toEqual(["C:/Kept"]);
    const ui = useUIStore.getState();
    expect(ui.recentFiles.map((file) => file.path)).toEqual(["C:/Kept/a.md"]);
    expect(ui.pinnedFiles).toEqual([]);
    expect(ui.openFolders).toEqual([]);
  });
});
