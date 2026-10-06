// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVaultStore } from "@/store";
import { NewFolderRow } from "./NewFolderRow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const VAULT = "C:/Notes";

function renderRow() {
  render(<NewFolderRow parent={`${VAULT}/Work`} depth={1} />);
  return screen.getByLabelText("Folder name");
}

describe("NewFolderRow", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useVaultStore.setState({
      currentVaultPath: VAULT,
      newFolderParent: `${VAULT}/Work`,
    });
  });

  afterEach(cleanup);

  it("creates the folder on Enter and refreshes the tree", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === "scan_vault" ? [] : undefined,
    );
    const input = renderRow();

    fireEvent.change(input, { target: { value: "  Projects " } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(invoke).toHaveBeenCalledWith("create_folder", {
      parent: `${VAULT}/Work`,
      name: "Projects",
    });
    expect(invoke).toHaveBeenCalledWith("scan_vault", { vaultPath: VAULT });
    expect(useVaultStore.getState().newFolderParent).toBeNull();
  });

  it("closes without creating anything on Escape or an empty name", async () => {
    const input = renderRow();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(useVaultStore.getState().newFolderParent).toBeNull();

    useVaultStore.setState({ newFolderParent: `${VAULT}/Work` });
    await act(async () => {
      fireEvent.blur(input);
    });

    expect(useVaultStore.getState().newFolderParent).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stays open to fix the name when Enter fails", async () => {
    vi.mocked(invoke).mockRejectedValue(
      "A folder with name 'Work' already exists",
    );
    const input = renderRow();

    fireEvent.change(input, { target: { value: "Work" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(useVaultStore.getState().newFolderParent).toBe(`${VAULT}/Work`);
  });
});
