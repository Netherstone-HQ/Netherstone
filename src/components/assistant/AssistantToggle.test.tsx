// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAssistantStore } from "@/store/assistant";
import { AssistantToggle } from "./AssistantToggle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("AssistantToggle", () => {
  beforeEach(() => {
    useAssistantStore.setState({ enabled: null, isOpen: false });
  });

  afterEach(() => {
    cleanup();
    vi.mocked(invoke).mockReset();
  });

  it("reads only the switch at launch, so no key is read while it's off", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    render(<AssistantToggle />);

    await waitFor(() => expect(useAssistantStore.getState().enabled).toBe(false));
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "assistant_enabled",
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("takes the switch when it's on", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    render(<AssistantToggle />);

    await waitFor(() => expect(useAssistantStore.getState().enabled).toBe(true));
  });

  it("stays unknown when the switch can't be read, so it isn't turned off", async () => {
    vi.mocked(invoke).mockRejectedValue("locked");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AssistantToggle />);

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(useAssistantStore.getState().enabled).toBeNull();
    error.mockRestore();
  });
});
