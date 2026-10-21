// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVaultFile } from "@/lib/open-vault-file";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { SearchModal } from "./SearchModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/open-vault-file", () => ({ openVaultFile: vi.fn(async () => {}) }));

const VAULT = "C:/Vault";

function renderSearch() {
  render(<SearchModal open onOpenChange={() => {}} />);
}

function search(query: string) {
  renderSearch();
  fireEvent.change(screen.getByPlaceholderText("Search your vault"), {
    target: { value: query },
  });
}

describe("SearchModal", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT });
    useUIStore.setState({ recentFiles: [] });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(invoke).mockReset();
    vi.mocked(openVaultFile).mockClear();
  });

  it("lists recent shards before anything is typed, and opens one", async () => {
    useUIStore.setState({
      recentFiles: [
        { path: `${VAULT}/Projects/Kitchen quote.md`, name: "Kitchen quote.md" },
        { path: "D:/Other/Elsewhere.md", name: "Elsewhere.md" },
      ],
    });
    renderSearch();

    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    fireEvent.click(screen.getByText("Kitchen quote"));
    expect(openVaultFile).toHaveBeenCalledWith(`${VAULT}/Projects/Kitchen quote.md`);
  });

  it("highlights the searched words in a result's name", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        path: `${VAULT}/Kitchen quote.md`,
        name: "Kitchen quote.md",
        snippet: [],
        rank: -1,
      },
    ]);
    search("quo");
    expect(await screen.findByText("1 shard")).toBeTruthy();
    expect(screen.getByText("quote").tagName).toBe("MARK");
    expect(screen.getByText("Kitchen").tagName).not.toBe("MARK");
  });

  it("says when nothing matches", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    search("tile grout");
    expect(await screen.findByText("No shards match “tile grout”")).toBeTruthy();
  });

  it("doesn't say nothing matches before the search answers", async () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
    search("tile grout");
    const noMatch = () => screen.queryByText("No shards match “tile grout”");
    expect(noMatch()).toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(noMatch()).toBeNull();
  });

  it("says when the search index can't be opened", async () => {
    vi.mocked(invoke).mockRejectedValue("unavailable");
    search("quote");
    expect(await screen.findByText("Couldn't open the search index")).toBeTruthy();
    expect(screen.getByText("Restart Netherstone and try again.")).toBeTruthy();
  });

  it("says when a search fails, and tries again", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("failed").mockResolvedValue([]);
    search("quote");
    expect(await screen.findByText("Search couldn't finish")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No shards match “quote”")).toBeTruthy();
  });
});
