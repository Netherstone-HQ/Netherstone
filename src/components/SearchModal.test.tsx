// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openVaultFile } from "@/lib/open-vault-file";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { SearchModal } from "./SearchModal";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (event: unknown) => void = () => {};
  },
}));
vi.mock("@/lib/open-vault-file", () => ({ openVaultFile: vi.fn(async () => {}) }));

const VAULT = "C:/Vault";

function renderSearch(onOpenChange: (open: boolean) => void = () => {}) {
  return render(<SearchModal open onOpenChange={onOpenChange} />);
}

function search(query: string) {
  renderSearch();
  fireEvent.change(screen.getByPlaceholderText("Search your vault"), {
    target: { value: query },
  });
}

// The command wrappers refuse to run outside the app.
beforeEach(() => {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchModal", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT });
    useUIStore.setState({ recentFiles: [] });
    useAssistantStore.setState({ enabled: false });
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

  it("shows a result's name and snippet with the searched words highlighted, and its section", async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        path: `${VAULT}/Kitchen quote.md`,
        name: "Kitchen quote.md",
        title: [
          { text: "Kitchen ", highlight: false },
          { text: "quote", highlight: true },
        ],
        snippet: [
          { text: "The ", highlight: false },
          { text: "quotes", highlight: true },
          { text: " came in.", highlight: false },
        ],
        section: "Costs",
        rank: -1,
      },
    ]);
    search("quo");
    expect(await screen.findByText("1 shard")).toBeTruthy();
    expect(screen.getByText("quote").tagName).toBe("MARK");
    expect(screen.getByText("quotes").tagName).toBe("MARK");
    expect(screen.getByText("Costs")).toBeTruthy();
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

  it("leaves search as it is while the assistant is off", async () => {
    useAssistantStore.setState({ enabled: false });
    vi.mocked(invoke).mockResolvedValue([RESULT]);
    search("quote");
    expect(await screen.findByText("1 shard")).toBeTruthy();
    expect(screen.queryByText("Assistant")).toBeNull();
    expect(screen.queryByText("Ask about this")).toBeNull();
    expect(screen.queryByText("Tab")).toBeNull();
    // Tab does what it does by default.
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(true);
  });
});

const RESULT = {
  path: `${VAULT}/Trip.md`,
  name: "Trip.md",
  title: [{ text: "Trip", highlight: false }],
  snippet: [{ text: "Lisbon in May", highlight: false }],
  section: null,
  rank: -1,
};

function input() {
  return screen.getByPlaceholderText("Search your vault");
}

type Ask = {
  args: Record<string, unknown>;
  send: (event: unknown) => void;
  finish: () => void;
};

/** The assistant on and set up, answering only when the test says so. */
function assistantOn({ provider = true } = {}) {
  const asks: Ask[] = [];
  const messages: unknown[] = [];
  vi.mocked(invoke).mockImplementation(async (command, raw) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    switch (command) {
      case "search_files":
        return [RESULT];
      case "assistant_enabled":
        return true;
      case "assistant_status":
        return {
          enabled: true,
          sendFiles: true,
          keyringAvailable: true,
          model: { provider: "anthropic", server: null, model: "m" },
          providers: [
            {
              id: "anthropic",
              name: "Anthropic",
              setup: "key",
              keyPage: null,
              key: provider ? "keyring" : null,
              servers: [],
              custom: null,
            },
          ],
        };
      case "assistant_picked":
        return { id: "m", name: "M", provider: "Anthropic", local: false, images: true };
      case "mcp_vaults":
        return [{ path: VAULT, name: "Vault", allowed: true }];
      case "assistant_send":
        return new Promise((resolve) => {
          const events = args.events as { onmessage: (event: unknown) => void };
          asks.push({
            args,
            send: (event) => events.onmessage(event),
            finish: () => resolve("chat-1"),
          });
        });
      case "assistant_chat":
        return { id: "chat-1", title: "Trip", messages, changes: [], memories: [] };
      case "assistant_stop":
      case "assistant_retitle":
        return "Trip";
      default:
        return null;
    }
  });
  useAssistantStore.setState({ enabled: true, isOpen: false });
  return { asks, messages };
}

const ANSWER = "We go in May [Trip](Trip.md#Plans).";

describe("SearchModal with the assistant", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: VAULT });
    useUIStore.setState({ recentFiles: [] });
  });

  afterEach(() => {
    cleanup();
    useAssistantStore.setState({
      enabled: false,
      isOpen: false,
      chat: null,
      messages: [],
      answering: null,
      ending: null,
      search: null,
    });
    vi.mocked(invoke).mockReset();
    vi.mocked(openVaultFile).mockClear();
  });

  it("offers to ask above the shards, and Enter still opens the shard", async () => {
    const { asks } = assistantOn();
    search("trip");
    expect(await screen.findByText("1 shard")).toBeTruthy();
    expect(screen.getByText("Assistant")).toBeTruthy();
    expect(screen.getByText("Ask about this")).toBeTruthy();
    expect(screen.getByText("Shards")).toBeTruthy();
    expect(screen.getByText("Tab")).toBeTruthy();

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(openVaultFile).toHaveBeenCalledWith(`${VAULT}/Trip.md`);
    expect(asks).toHaveLength(0);
  });

  it("asks with Tab, streams the cited answer in place, and continues in chat", async () => {
    const { asks, messages } = assistantOn();
    // A chat open in the panel, and a shard in Recent.
    const earlier = [{ seq: 1, role: "user" as const, text: "Earlier", shards: [] }];
    useAssistantStore.setState({
      chat: { id: "panel-chat", title: "Earlier" },
      messages: earlier,
    });
    useUIStore.setState({
      recentFiles: [{ path: `${VAULT}/Notes/Plan.md`, name: "Plan.md" }],
    });
    const onOpenChange = vi.fn();
    renderSearch(onOpenChange);
    fireEvent.change(input(), { target: { value: "when do we go" } });
    expect(await screen.findByText("1 shard")).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_vaults"));
    // Wait for the setup to be read, then ask.
    await screen.findByText("Ask about this");
    fireEvent.keyDown(input(), { key: "Tab" });

    await waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].args).toMatchObject({
      chat: null,
      vault: VAULT,
      text: "when do we go",
      shards: [],
      recent: ["Notes/Plan.md"],
    });
    expect(await screen.findByText("Waiting for the answer")).toBeTruthy();

    asks[0].send({ type: "chat", id: "chat-1" });
    asks[0].send({ type: "text", text: ANSWER });
    expect(await screen.findByText(/We go in May/)).toBeTruthy();
    // The cite names its shard, then its number in the list.
    expect(screen.getByRole("button", { name: "Open Trip.md" }).textContent).toBe("Trip1");
    // The shard results stay below.
    expect(screen.getByText("Lisbon in May")).toBeTruthy();
    // The panel keeps its own chat while search answers.
    expect(useAssistantStore.getState().chat?.id).toBe("panel-chat");
    expect(useAssistantStore.getState().messages).toBe(earlier);
    expect(useAssistantStore.getState().answering).toBeNull();

    messages.push(
      { seq: 1, role: "user", text: "when do we go" },
      { seq: 2, role: "assistant", text: ANSWER },
    );
    asks[0].send({ type: "done", stop: "done" });
    asks[0].finish();
    const next = await screen.findByRole("button", { name: "Continue in chat" });
    fireEvent.click(next);
    expect(useAssistantStore.getState().isOpen).toBe(true);
    expect(useAssistantStore.getState().chat?.id).toBe("chat-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens a cited shard at its section, and closes search", async () => {
    const { asks } = assistantOn();
    const onOpenChange = vi.fn();
    renderSearch(onOpenChange);
    fireEvent.change(input(), { target: { value: "when" } });
    await screen.findByText("Ask about this");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_vaults"));
    fireEvent.click(screen.getByText("Ask about this"));
    await waitFor(() => expect(asks).toHaveLength(1));
    asks[0].send({ type: "chat", id: "chat-1" });
    asks[0].send({ type: "text", text: ANSWER });

    fireEvent.click(await screen.findByRole("button", { name: "Open Trip.md" }));
    expect(useEditorStore.getState().pendingLinkReveal).toEqual({
      path: `${VAULT}/Trip.md`,
      heading: "Plans",
    });
    expect(openVaultFile).toHaveBeenCalledWith(`${VAULT}/Trip.md`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stops the answer when search closes while it streams, and leaves the panel's chat", async () => {
    const { asks } = assistantOn();
    useAssistantStore.setState({ chat: { id: "panel-chat", title: "Earlier" } });
    const view = renderSearch();
    fireEvent.change(input(), { target: { value: "when" } });
    await screen.findByText("Ask about this");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_vaults"));
    fireEvent.keyDown(input(), { key: "Tab" });
    await waitFor(() => expect(asks).toHaveLength(1));
    asks[0].send({ type: "chat", id: "chat-1" });

    expect(useAssistantStore.getState().chat?.id).toBe("panel-chat");

    view.rerender(<SearchModal open={false} onOpenChange={() => {}} />);
    expect(invoke).toHaveBeenCalledWith("assistant_stop", { chat: "chat-1" });
    expect(useAssistantStore.getState().search).toBeNull();
    expect(useAssistantStore.getState().chat?.id).toBe("panel-chat");
  });

  it("stops the answer and drops the group when the assistant is turned off", async () => {
    const { asks } = assistantOn();
    renderSearch();
    fireEvent.change(input(), { target: { value: "when" } });
    await screen.findByText("Ask about this");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_vaults"));
    fireEvent.keyDown(input(), { key: "Tab" });
    await waitFor(() => expect(asks).toHaveLength(1));
    asks[0].send({ type: "chat", id: "chat-1" });

    useAssistantStore.getState().setEnabled(false);
    expect(invoke).toHaveBeenCalledWith("assistant_stop", { chat: "chat-1" });
    await waitFor(() => expect(screen.queryByText("Assistant")).toBeNull());
    expect(screen.queryByText("Tab")).toBeNull();
    // Tab does what it does by default, and asks nothing.
    expect(await screen.findByText("1 shard")).toBeTruthy();
    expect(fireEvent.keyDown(input(), { key: "Tab" })).toBe(true);
    expect(asks).toHaveLength(1);
  });

  it("says what's missing before it can ask, as the panel does", async () => {
    const { asks } = assistantOn({ provider: false });
    renderSearch();
    fireEvent.change(input(), { target: { value: "when" } });
    await screen.findByText("Ask about this");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("mcp_vaults"));
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(await screen.findByText("No AI provider set up")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
    expect(asks).toHaveLength(0);
  });
});
