// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FreeUpSpaceRow } from "./FreeUpSpaceRow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const VAULT = "C:/vault";
const OLD = [
  {
    path: "_attachments/video.mp4",
    sizeBytes: 3 * 1024 * 1024,
    blobs: ["a1", "a2"],
  },
  { path: "_attachments/pic.png", sizeBytes: 1024 * 1024, blobs: ["b1"] },
];

function mockCommands(old: typeof OLD) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "history_old_attachments") return old;
    if (command === "history_free_up_space") return { bytes: 3 * 1024 * 1024 };
    return undefined;
  });
}

describe("FreeUpSpaceRow", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  afterEach(cleanup);

  it("says what old versions take and frees only the ones still ticked", async () => {
    mockCommands(OLD);
    render(<FreeUpSpaceRow vaultPath={VAULT} />);
    expect(
      await screen.findByText("They take 4.0 MB in history."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Free up space" }));
    expect(screen.getByText("Free up 4.0 MB?")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]);
    expect(screen.getByText("Free up 3.0 MB?")).toBeTruthy();

    mockCommands([OLD[1]]);
    const dialog = screen.getByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Free up space",
    )!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("history_free_up_space", {
        vaultPath: VAULT,
        blobs: ["a1", "a2"],
      }),
    );
    expect(
      await screen.findByText("They take 1.0 MB in history."),
    ).toBeTruthy();
  });

  it("has nothing to free in a history without old versions", async () => {
    mockCommands([]);
    render(<FreeUpSpaceRow vaultPath={VAULT} />);
    expect(await screen.findByText("Nothing to free up.")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Free up space",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
