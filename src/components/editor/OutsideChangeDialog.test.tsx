// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepVersion } from "@/lib/outside-changes";
import { useEditorStore } from "@/store/editor";
import { OutsideChangeDialog } from "./OutsideChangeDialog";

vi.mock("@/lib/outside-changes", () => ({ keepVersion: vi.fn(async () => {}) }));
vi.mock("@/hooks/useAutosave", () => ({ flushPendingAutosave: vi.fn(async () => {}) }));

afterEach(() => {
  cleanup();
  act(() => useEditorStore.getState().setOutsideChange(null));
  vi.clearAllMocks();
});

describe("OutsideChangeDialog", () => {
  it("shows nothing without an outside change", () => {
    render(<OutsideChangeDialog />);
    expect(screen.queryByText("Choose which version to keep")).toBeNull();
  });

  it("compares both versions and keeps the one chosen", async () => {
    act(() =>
      useEditorStore.getState().setOutsideChange({
        path: "C:/vault/Plan.md",
        mine: "# Plan\nmine",
        outside: "# Plan\ntheirs",
      }),
    );
    render(<OutsideChangeDialog />);

    expect(screen.getByText("Choose which version to keep")).toBeTruthy();
    // Each side marks the words only it has.
    expect((await screen.findByText("mine")).closest(".history-added")).toBeTruthy();
    expect(screen.getByText("theirs").closest(".history-added")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep both" }).getAttribute("title")).toContain(
      "Plan (Changed outside).md",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep outside version" }));
    await waitFor(() => expect(keepVersion).toHaveBeenCalledWith("outside"));
  });
});
