// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantProvider, AssistantStatus } from "@/lib/commands";
import { AiAssistantSettings } from "./AiAssistantSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

function provider(
  id: string,
  name: string,
  setup: AssistantProvider["setup"],
  more: Partial<AssistantProvider> = {},
): AssistantProvider {
  return {
    id,
    name,
    setup,
    keyPage: setup === "key" ? `https://${id}.example/keys` : null,
    key: null,
    servers: [],
    custom: null,
    ...more,
  };
}

function status(more: Partial<AssistantStatus> = {}): AssistantStatus {
  return {
    enabled: false,
    keyringAvailable: true,
    model: null,
    providers: [
      provider("openai", "OpenAI", "key"),
      provider("anthropic", "Anthropic", "key", { key: "keyring" }),
      provider("local", "Local server", "local"),
      provider("custom", "Custom", "custom"),
    ],
    ...more,
  };
}

const MODEL = {
  id: "claude-sonnet-5-5",
  name: "Claude Sonnet 5.5",
  reasoning: true,
  tools: true,
  images: true,
  pdfs: true,
  caching: true,
  responsesOnly: false,
};

describe("AiAssistantSettings", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  afterEach(cleanup);

  it("shows saved keys with their model count, and never asks for a key back", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status") return status();
      if (command === "assistant_models") return [MODEL];
      return undefined;
    });
    render(<AiAssistantSettings />);
    expect(await screen.findByText(/1 model/)).toBeTruthy();
    expect(screen.getByText(/Key saved/)).toBeTruthy();
    const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
    expect(commands).toContain("assistant_models");
    expect(commands.every((c) => !c.includes("get_key"))).toBe(true);
  });

  it("checks a key before saving it and says when it's refused", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status") return status();
      if (command === "assistant_models") return [MODEL];
      if (command === "assistant_save_key") throw { kind: "keyRefused" };
      return undefined;
    });
    render(<AiAssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    fireEvent.change(screen.getByLabelText("OpenAI key"), {
      target: { value: " sk-test " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("OpenAI didn't accept this key"),
    ).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("assistant_save_key", {
      provider: "openai",
      key: " sk-test ",
      remember: true,
    });
  });

  it("asks whether to keep keys only on computers without a keyring", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status")
        return status({ keyringAvailable: false });
      if (command === "assistant_models") return [MODEL];
      return undefined;
    });
    render(<AiAssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    expect(screen.getByText("Keep the key on this computer")).toBeTruthy();
  });

  it("offers an address to type when no local server is running", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status") return status();
      if (command === "assistant_models") return [MODEL];
      if (command === "assistant_find_local") return [];
      return undefined;
    });
    render(<AiAssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Find" }));
    expect(
      await screen.findByText("Nothing running on the usual ports"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Server address")).toBeTruthy();
  });

  it("names a local server found and its models", async () => {
    const ollama = {
      kind: "ollama" as const,
      address: "http://localhost:11434",
    };
    let found = false;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status")
        return status({
          providers: [
            provider("local", "Local server", "local", {
              servers: found ? [ollama] : [],
            }),
          ],
        });
      if (command === "assistant_find_local") {
        found = true;
        return [{ ...ollama, models: [MODEL, { ...MODEL, id: "qwen" }] }];
      }
      return undefined;
    });
    render(<AiAssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Find" }));
    expect(await screen.findByText(/2 models/)).toBeTruthy();
    expect(screen.getByText(/Ollama/)).toBeTruthy();
    expect(screen.getByText(/localhost:11434/)).toBeTruthy();
  });

  it("says a key needs https to go to another computer", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "assistant_status") return status();
      if (command === "assistant_models") return [MODEL];
      if (command === "assistant_save_custom") throw { kind: "insecure" };
      return undefined;
    });
    render(<AiAssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "http://192.168.1.20:8000/v1" },
    });
    fireEvent.change(screen.getByLabelText("Key"), {
      target: { value: "tk-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        "Use an https address to send a key to another computer",
      ),
    ).toBeTruthy();
  });
});
