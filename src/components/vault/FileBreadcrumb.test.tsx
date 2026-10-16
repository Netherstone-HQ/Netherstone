// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUIStore, useVaultStore } from "@/store";
import { FileBreadcrumb } from "./FileBreadcrumb";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

const VAULT = "C:/Notes";
const SHARD = `${VAULT}/Work/Plans/Q3.md`;

function renderBreadcrumb(path: string | null, onClose = vi.fn()) {
  return render(
    <TooltipProvider>
      <FileBreadcrumb path={path} onClose={onClose} />
    </TooltipProvider>,
  );
}

function openNameMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  });
}

describe("FileBreadcrumb", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT });
    useUIStore.setState({
      isSidebarOpen: true,
      treeReveal: null,
      pinnedFiles: [],
    });
  });

  afterEach(cleanup);

  it("names the vault only while the left sidebar is hidden", () => {
    renderBreadcrumb(SHARD);
    expect(screen.queryByText("Notes")).toBeNull();

    act(() => useUIStore.setState({ isSidebarOpen: false }));

    expect(screen.getByText("Notes")).toBeTruthy();
  });

  it("reveals a folder in the tree", () => {
    useUIStore.setState({ isSidebarOpen: false });
    renderBreadcrumb(SHARD);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(useUIStore.getState().treeReveal).toEqual({
      path: `${VAULT}/Work`,
    });
    expect(useUIStore.getState().isSidebarOpen).toBe(true);
  });

  it("opens the shard's actions from its name, with Close before the trash", async () => {
    const onClose = vi.fn();
    renderBreadcrumb(SHARD, onClose);

    openNameMenu("Q3");
    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );

    expect(items).toEqual([
      "Pin",
      "Rename",
      "Move",
      "Open location",
      "Export…",
      "Close",
      "Move to trash",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("renames the shard in place", async () => {
    renderBreadcrumb(SHARD);

    openNameMenu("Q3");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByDisplayValue("Q3");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});
