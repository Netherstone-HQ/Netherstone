// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantStatus, PickedModel } from "@/lib/commands/assistant";
import { useVaultStore } from "@/store/vault";
import { serverDownText, setupState, useSetup } from "./setup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const VAULT = "/vaults/Research";

const status = (enabled: boolean): AssistantStatus => ({
  enabled,
  sendFiles: false,
  keyringAvailable: true,
  model: { provider: "local", model: "qwen3", server: "http://localhost:11434" },
  providers: [
    {
      id: "local",
      name: "Local server",
      setup: "local",
      keyPage: null,
      key: null,
      servers: [{ kind: "ollama", address: "http://localhost:11434" }],
      custom: null,
    },
  ],
});

const picked = (local: boolean): PickedModel => ({
  id: "qwen3",
  provider: local ? "Local server" : "Anthropic",
  local,
  images: false,
  thinking: null,
});

/** The app's answers, with the local server answering or not. */
function mockApp({ enabled = true, local = true, running = false } = {}) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    switch (command) {
      case "assistant_status":
        return status(enabled);
      case "assistant_picked":
        return picked(local);
      case "mcp_vaults":
        return [{ path: VAULT, name: "Research", allowed: true }];
      case "assistant_local_down":
        return running ? null : "ollama";
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  useVaultStore.setState({ currentVaultPath: VAULT });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSetup", () => {
  it("says when the picked local server isn't running", async () => {
    mockApp();
    const { result } = renderHook(() => useSetup());
    await waitFor(() => expect(setupState(result.current.setup)).toBe("serverDown"));
    expect(serverDownText("ollama")).toBe("Ollama isn't running");
    expect(serverDownText("other")).toBe("The local server isn't running");
  });

  it("is ready once the server answers again", async () => {
    mockApp();
    const { result } = renderHook(() => useSetup());
    await waitFor(() => expect(setupState(result.current.setup)).toBe("serverDown"));

    mockApp({ running: true });
    await result.current.reload();
    await waitFor(() => expect(setupState(result.current.setup)).toBe("ready"));
  });

  it("doesn't probe for a cloud model or while the assistant is off", async () => {
    mockApp({ local: false });
    const cloud = renderHook(() => useSetup());
    await waitFor(() => expect(setupState(cloud.result.current.setup)).toBe("ready"));

    mockApp({ enabled: false });
    const off = renderHook(() => useSetup());
    await waitFor(() => expect(off.result.current.setup).not.toBeNull());

    expect(invoke).not.toHaveBeenCalledWith("assistant_local_down");
  });
});
