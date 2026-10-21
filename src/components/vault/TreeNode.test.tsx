// @vitest-environment jsdom
import {
  act,
  waitFor,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
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

// Rows drag and take drops, so they need the app's drag context.
function renderNode(node: FileTreeNode) {
  return render(
    <DndProvider backend={HTML5Backend}>
      <TreeNode node={node} />
    </DndProvider>,
  );
}

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
    renderNode(FOLDER);

    const event = openMenuOn("Work");

    expect(event.defaultPrevented).toBe(true);
    for (const item of [
      "New shard",
      "New folder",
      "Rename",
      "Open location",
      "Move to trash",
    ]) {
      expect(screen.getByRole("menuitem", { name: item })).toBeTruthy();
    }
  });

  it("names a new folder inside the folder it was opened on", async () => {
    renderNode(FOLDER);

    openMenuOn("Work");
    fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Folder name")),
    );
    expect(useVaultStore.getState().newFolderParent).toBe(FOLDER.path);
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  it("keeps focus in the rename field once the menu has closed", async () => {
    renderNode(FOLDER.children![0]);

    openMenuOn("Plan");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByDisplayValue("Plan");
    await waitFor(() => expect(document.activeElement).toBe(input));
    // The menu has finished closing and nothing takes focus back.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers moving, not creating, on a shard", () => {
    renderNode(FOLDER.children![0]);

    openMenuOn("Plan");

    expect(screen.getByRole("menuitem", { name: "Move" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "New folder" })).toBeNull();
  });

  it("puts Pin first on a shard, and Unpin once it's pinned", async () => {
    useUIStore.setState({ pinnedFiles: [] });
    renderNode(FOLDER.children![0]);

    openMenuOn("Plan");
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items[0]).toBe("Pin");
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));

    await waitFor(() =>
      expect(useUIStore.getState().pinnedFiles).toEqual([
        { path: `${VAULT}/Work/Plan.md`, name: "Plan.md" },
      ]),
    );
    openMenuOn("Plan");
    expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeTruthy();
  });

  it("doesn't offer pinning a folder", () => {
    renderNode(FOLDER);

    openMenuOn("Work");

    expect(screen.queryByRole("menuitem", { name: "Pin" })).toBeNull();
  });
});

describe("TreeNode path changes", () => {
  const RENAMED = `${VAULT}/Projects`;

  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT, newFolderParent: null });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rename_file") return RENAMED;
      if (command === "scan_vault") return [];
      if (command === "find_shards_containing") return [];
      if (command === "sync_snapshot_vault") return { commit: null };
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(invoke).mockReset();
    useEditorStore.setState({ currentFilePath: null });
    useUIStore.setState({ recentFiles: [] });
  });

  it("keeps the open shard and recent files when their folder is renamed", async () => {
    useEditorStore.setState({
      currentFilePath: `${VAULT}/Work/Plan.md`,
      markdownContent: "# Plan",
      plateEditor: null,
    });
    useUIStore.setState({
      recentFiles: [
        { path: `${VAULT}/Work/Plan.md`, name: "Plan.md" },
        { path: `${VAULT}/Home.md`, name: "Home.md" },
      ],
    });
    renderNode(FOLDER);

    openMenuOn("Work");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Projects" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(useEditorStore.getState().currentFilePath).toBe(
        `${RENAMED}/Plan.md`,
      ),
    );
    expect(invoke).toHaveBeenCalledWith("save_markdown_file", {
      filePath: `${VAULT}/Work/Plan.md`,
      content: "# Plan",
    });
    expect(useUIStore.getState().recentFiles.map((f) => f.path)).toEqual([
      `${RENAMED}/Plan.md`,
      `${VAULT}/Home.md`,
    ]);
  });

  it("saves a version right after a rename, so the history follows it", async () => {
    renderNode(FOLDER);

    openMenuOn("Work");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = await screen.findByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Projects" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("sync_snapshot_vault", {
        vaultPath: VAULT,
      }),
    );
  });

  it("offers Move on a folder too", () => {
    renderNode(FOLDER);

    openMenuOn("Work");

    expect(screen.getByRole("menuitem", { name: "Move" })).toBeTruthy();
  });
});

describe("TreeNode reveal", () => {
  const NESTED: FileTreeNode = {
    name: "Work",
    path: `${VAULT}/Work`,
    kind: "directory",
    children: [
      {
        name: "Plans",
        path: `${VAULT}/Work/Plans`,
        kind: "directory",
        children: [
          { name: "Q3.md", path: `${VAULT}/Work/Plans/Q3.md`, kind: "file" },
        ],
      },
    ],
  };

  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT, newFolderParent: null });
    useUIStore.setState({ isSidebarOpen: false, treeReveal: null });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it("opens the folders down to a revealed folder and focuses it", async () => {
    renderNode(NESTED);
    expect(screen.queryByText("Plans")).toBeNull();

    act(() => useUIStore.getState().revealInTree(`${VAULT}/Work/Plans`));

    const plans = await screen.findByRole("button", { name: "Plans" });
    await waitFor(() => expect(document.activeElement).toBe(plans));
    expect(screen.getByText("Q3")).toBeTruthy();
    expect(plans.scrollIntoView).toHaveBeenCalled();
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
  });
});
