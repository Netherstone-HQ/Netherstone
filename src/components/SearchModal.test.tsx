// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchModal } from "./SearchModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function search(query: string) {
  render(<SearchModal open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Search your vault..."), {
    target: { value: query },
  });
}

describe("SearchModal", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(invoke).mockReset();
  });

  it("says when nothing matches", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    search("quote");
    expect(await screen.findByText("No results found")).toBeTruthy();
  });

  it("says when the search index can't be opened", async () => {
    vi.mocked(invoke).mockRejectedValue("unavailable");
    search("quote");
    expect(
      await screen.findByText(
        "Couldn't open the search index. Restart Netherstone and try again.",
      ),
    ).toBeTruthy();
  });

  it("says when a search fails", async () => {
    vi.mocked(invoke).mockRejectedValue("failed");
    search("quote");
    expect(
      await screen.findByText("Search couldn't finish. Try again."),
    ).toBeTruthy();
  });
});
