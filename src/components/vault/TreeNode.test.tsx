// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import { TreeNode } from "./TreeNode";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

const VAULT = "C:/Notes";
const FOLDER: FileTreeNode = {
  name: "Work",
  path: `${VAULT}/Work`,
  kind: "directory",
  children: [{ name: "Plan.md", path: `${VAULT}/Work/Plan.md`, kind: "file" }],
};

function openMenuOn(text: string) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    screen.getByText(text).dispatchEvent(event);
  });
  return event;
}

describe("TreeNode right-click menu", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT, newFolderParent: null });
  });

  afterEach(cleanup);

  it("replaces the webview's menu on a folder", () => {
    render(<TreeNode node={FOLDER} />);

    const event = openMenuOn("Work");

    expect(event.defaultPrevented).toBe(true);
    for (const item of [
      "New Shard",
      "New Folder",
      "Rename",
      "Open location",
      "Move to Trash",
    ]) {
      expect(screen.getByRole("menuitem", { name: item })).toBeTruthy();
    }
  });

  it("names a new folder inside the folder it was opened on", () => {
    render(<TreeNode node={FOLDER} />);

    openMenuOn("Work");
    fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));

    expect(useVaultStore.getState().newFolderParent).toBe(FOLDER.path);
    expect(screen.getByLabelText("Folder name")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  it("offers moving, not creating, on a shard", () => {
    render(<TreeNode node={FOLDER.children![0]} />);

    openMenuOn("Plan");

    expect(screen.getByRole("menuitem", { name: "Move" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "New Folder" })).toBeNull();
  });
});
