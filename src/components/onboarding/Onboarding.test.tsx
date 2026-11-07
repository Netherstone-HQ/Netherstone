// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantToggle } from "@/components/assistant/AssistantToggle";
import { setupState, useSetup } from "@/components/assistant/setup";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AssistantProvider, AssistantStatus } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import { useAssistantStore } from "@/store/assistant";
import { useSettingsStore } from "@/store/settings";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";
import { copy } from "./copy";
import { Onboarding } from "./Onboarding";
import startHere from "./start-here.md?raw";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@/lib/open-editor-file", () => ({ openEditorFile: vi.fn(async () => {}) }));
vi.mock("@/components/WindowTitleBar", () => ({ WindowTitleBar: () => null }));

const DOCUMENTS = "/home/me/Documents";
const RESEARCH = "/vaults/Research";

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function mockCommands(handlers: Handlers) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, unknown>) : undefined;
  });
}

function provider(
  id: string,
  name: string,
  setup: AssistantProvider["setup"],
): AssistantProvider {
  return { id, name, setup, keyPage: null, key: null, servers: [], custom: null };
}

const MODELS = ["Sonnet 5.5", "Opus 5.5"].map((name) => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  reasoning: true,
  tools: true,
  images: true,
  pdfs: true,
  caching: true,
  responsesOnly: false,
}));

/** The assistant's commands, kept like the app keeps them. Keys aren't checked. */
function assistantCommands(more: Partial<AssistantStatus> = {}): Handlers {
  let state: AssistantStatus = {
    enabled: false,
    sendFiles: false,
    keyringAvailable: true,
    model: null,
    providers: [
      provider("openai", "OpenAI", "key"),
      provider("anthropic", "Anthropic", "key"),
      provider("google", "Google", "key"),
      provider("openrouter", "OpenRouter", "key"),
      provider("local", "Local server", "local"),
      provider("custom", "Custom", "custom"),
    ],
    ...more,
  };
  let vaults = [{ path: RESEARCH, name: "Research", allowed: false }];
  return {
    mcp_vaults: () => vaults,
    mcp_set_vault_allowed: ({ path, allowed }) => {
      vaults = vaults.map((v) => (v.path === path ? { ...v, allowed: allowed as boolean } : v));
    },
    assistant_picked: () => state.model,
    assistant_enabled: () => state.enabled,
    assistant_status: () => state,
    assistant_models: () => MODELS,
    assistant_save_key: ({ provider: id }) => {
      state = {
        ...state,
        providers: state.providers.map((p) => (p.id === id ? { ...p, key: "keyring" } : p)),
      };
      return MODELS;
    },
    assistant_set_enabled: ({ enabled }) => {
      state = { ...state, enabled: enabled as boolean };
    },
    assistant_set_model: ({ choice }) => {
      state = { ...state, model: choice as AssistantStatus["model"] };
    },
  };
}

const baseCommands: Handlers = {
  default_vault_location: () => DOCUMENTS,
  scan_vault: () => [],
  sync_get_vault_record: () => null,
  github_get_account: () => null,
  ...assistantCommands(),
};

/** Keeps the open vault and skips sync, to the assistant step. */
async function toAssistantStep() {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(copy.vault.keep.title("Research")) }),
  );
  await screen.findByText(copy.appearance.title);
  fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));
  fireEvent.click(await screen.findByRole("button", { name: copy.common.skip }));
  await screen.findByText(copy.assistant.title);
}

async function renderOnboarding() {
  const onDone = vi.fn();
  render(<Onboarding onDone={onDone} />);
  fireEvent.click(await screen.findByRole("button", { name: copy.welcome.start }));
  return onDone;
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  useSettingsStore.setState({ onboardingCompletedAt: null, theme: "dark" });
  useVaultStore.setState({ currentVaultPath: null, fileTree: [] });
  useSyncStore.setState({ vaultPath: null, record: null, loaded: false });
  useGitHubStore.setState({ account: null, loaded: false, error: null });
  useAssistantStore.setState({ enabled: null, isOpen: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Onboarding", () => {
  it("creates a vault with the Start here shard and opens it at the end", async () => {
    mockCommands(baseCommands);
    const onDone = await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /Create a new vault/ }));
    await screen.findByText(DOCUMENTS);
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "create_vault") return `${DOCUMENTS}/My Vault`;
      const handler = baseCommands[command];
      return handler ? handler((args ?? {}) as Record<string, unknown>) : undefined;
    });
    fireEvent.click(screen.getByRole("button", { name: copy.vault.create.submit }));

    await screen.findByText(copy.appearance.title);
    expect(invoke).toHaveBeenCalledWith("create_vault", {
      parent: DOCUMENTS,
      name: copy.vault.create.defaultName,
    });
    expect(invoke).toHaveBeenCalledWith("save_markdown_file", {
      filePath: `${DOCUMENTS}/My Vault/Start here.md`,
      content: startHere,
    });
    expect(useVaultStore.getState().currentVaultPath).toBe(`${DOCUMENTS}/My Vault`);

    expect(screen.queryByRole("radio", { name: "Citadel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.appearance.moreThemes }));
    fireEvent.click(screen.getByRole("radio", { name: "Citadel" }));
    expect(useSettingsStore.getState().theme).toBe("citadel");

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(useSettingsStore.getState().theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));

    await screen.findByText(copy.sync.title);
    fireEvent.click(screen.getByRole("button", { name: copy.common.skip }));
    await screen.findByText(copy.assistant.title);
    fireEvent.click(await screen.findByRole("button", { name: copy.common.skip }));

    await screen.findByText(copy.ready.body);
    fireEvent.click(screen.getByRole("button", { name: copy.ready.finish }));

    expect(useSettingsStore.getState().onboardingCompletedAt).not.toBeNull();
    expect(openEditorFile).toHaveBeenCalledWith(`${DOCUMENTS}/My Vault/Start here.md`);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("explains a vault name that can't be used", async () => {
    mockCommands({
      ...baseCommands,
      create_vault: () => {
        throw "vault-folder-not-empty";
      },
    });
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /Create a new vault/ }));
    await screen.findByText(DOCUMENTS);
    fireEvent.click(screen.getByRole("button", { name: copy.vault.create.submit }));

    await screen.findByText(copy.vault.errors["vault-folder-not-empty"]);
    expect(screen.queryByText(copy.appearance.title)).toBeNull();
  });

  it("shows sync as already on for an open vault, and offers it the guide", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    mockCommands({
      ...baseCommands,
      github_get_account: () => ({ login: "octocat", name: null, avatarUrl: null }),
      sync_get_vault_record: () => ({ vaultPath: "/vaults/Research", syncEnabled: true }),
    });
    const onDone = await renderOnboarding();

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(copy.vault.keep.title("Research")) }),
    );
    await screen.findByText(copy.appearance.title);
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));

    await screen.findByText(copy.sync.alreadyOn);
    expect(screen.getByText(copy.sync.note)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));
    await screen.findByText(copy.assistant.title);
    fireEvent.click(await screen.findByRole("button", { name: copy.common.skip }));

    await screen.findByText(copy.ready.body);
    expect(screen.getByRole("checkbox", { name: copy.ready.addGuide })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.ready.finish }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("save_markdown_file", {
      filePath: "/vaults/Research/Start here.md",
      content: startHere,
    });
    expect(openEditorFile).toHaveBeenCalledWith("/vaults/Research/Start here.md");
  });

  it("closes a shard and drawing left open from another vault", async () => {
    useVaultStore.setState({ currentVaultPath: "/vaults/My Vault" });
    useEditorStore.setState({ currentFilePath: "/vaults/My Vault/Ideas.md", isDirty: false });
    useUIStore.setState({ activeDrawingPath: "/vaults/My Vault/Sketch.excalidraw" });
    mockCommands({ ...baseCommands, open_vault_dialog: () => "/vaults/Research" });
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /Open a folder/ }));

    await screen.findByText(copy.appearance.title);
    expect(useVaultStore.getState().currentVaultPath).toBe("/vaults/Research");
    expect(useEditorStore.getState().currentFilePath).toBeNull();
    expect(useUIStore.getState().activeDrawingPath).toBeNull();
  });

  it("doesn't say sync is on until GitHub is connected", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    mockCommands({
      ...baseCommands,
      sync_get_vault_record: () => ({ vaultPath: "/vaults/Research", syncEnabled: true }),
    });
    await renderOnboarding();

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(copy.vault.keep.title("Research")) }),
    );
    await screen.findByText(copy.appearance.title);
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));

    await screen.findByText(copy.sync.later);
    expect(screen.queryByText(copy.sync.alreadyOn)).toBeNull();
    expect(screen.getByRole("button", { name: copy.common.skip })).toBeTruthy();
  });

  it("says when synced vaults can't be listed, and tries again", async () => {
    let online = false;
    mockCommands({
      ...baseCommands,
      github_get_account: () => ({ login: "octocat", name: null, avatarUrl: null }),
      github_get_installation: () => ({ installed: true, installedOn: [], installUrl: "" }),
      sync_list_backups: () => {
        if (!online) {
          throw "Couldn't reach GitHub. Check your internet connection and try again.";
        }
        return [{ fullName: "octocat/Notes", name: "Notes", cloneUrl: "", pushedAt: null }];
      },
    });
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /Restore a synced vault/ }));
    await screen.findByText(/Couldn't reach GitHub/);
    expect(screen.queryByText(copy.vault.restore.empty)).toBeNull();

    online = true;
    fireEvent.click(screen.getByRole("button", { name: copy.vault.restore.retry }));
    expect(await screen.findByRole("radio", { name: /Notes/ })).toBeTruthy();
  });

  it("refuses a backup that a vault around the new folder uses, before making the folder", async () => {
    const refusal = 'This backup belongs to "Documents" (/home/me/Documents), and this vault is inside it. Pick another backup.';
    mockCommands({
      ...baseCommands,
      github_get_account: () => ({ login: "octocat", name: null, avatarUrl: null }),
      github_get_installation: () => ({ installed: true, installedOn: [], installUrl: "" }),
      sync_list_backups: () => [
        { fullName: "octocat/Notes", name: "Notes", cloneUrl: "", pushedAt: null },
      ],
      sync_check_backup: () => {
        throw refusal;
      },
    });
    await renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /Restore a synced vault/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: copy.vault.restore.submit }));

    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("sync_check_backup", {
      vaultPath: `${DOCUMENTS}/Notes`,
      fullName: "octocat/Notes",
    });
    expect(invoke).not.toHaveBeenCalledWith("create_vault", expect.anything());
  });

  it("leaves the guide unticked when the tour is replayed", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    mockCommands(baseCommands);
    render(
      <TooltipProvider>
        <Onboarding onDone={vi.fn()} onClose={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: copy.welcome.start }));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(copy.vault.keep.title("Research")) }),
    );
    await screen.findByText(copy.appearance.title);
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));
    fireEvent.click(await screen.findByRole("button", { name: copy.common.skip }));
    await screen.findByText(copy.assistant.title);
    fireEvent.click(await screen.findByRole("button", { name: copy.common.skip }));

    const guide = await screen.findByRole("checkbox", { name: copy.ready.addGuide });
    expect(guide.getAttribute("aria-checked")).toBe("false");
  });

  it("turns the assistant on with a saved key and picks its first model", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    mockCommands({ ...baseCommands, ...assistantCommands() });
    await renderOnboarding();
    await toAssistantStep();

    expect(
      screen.getByText(/Some providers' free plans train their models on your chats\./),
    ).toBeTruthy();
    expect(screen.getByText(copy.assistant.later)).toBeTruthy();
    expect(screen.queryByText("Custom")).toBeNull();
    expect(screen.getByRole("img", { name: copy.common.stepLabel(4, 5) })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[1]);
    fireEvent.change(screen.getByLabelText("Anthropic key"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(copy.assistant.on);
    expect(invoke).toHaveBeenCalledWith("assistant_set_enabled", { enabled: true });
    expect(invoke).toHaveBeenCalledWith("assistant_set_model", {
      choice: { provider: "anthropic", model: MODELS[0].id, server: null },
    });
    expect(useAssistantStore.getState().enabled).toBe(true);
    expect(await screen.findByText("Sonnet 5.5")).toBeTruthy();
    expect(screen.getByText(/Key saved/)).toBeTruthy();
    expect(screen.queryByText(copy.assistant.later)).toBeNull();
    expect(await screen.findByText(copy.assistant.vaultOn("Research"))).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("mcp_set_vault_allowed", {
      path: RESEARCH,
      allowed: true,
    });

    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));
    expect(await screen.findByText(copy.ready.tips.assistant)).toBeTruthy();

    // The panel can chat in the vault straight away.
    const { result } = renderHook(() => useSetup());
    await waitFor(() => expect(setupState(result.current.setup)).toBe("ready"));
  });

  it("leaves nothing of the assistant behind when it's skipped", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    mockCommands({ ...baseCommands, ...assistantCommands() });
    await renderOnboarding();
    await toAssistantStep();

    fireEvent.click(screen.getByRole("button", { name: copy.common.skip }));
    await screen.findByText(copy.ready.body);

    expect(screen.queryByText(copy.ready.tips.assistant)).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("assistant_set_enabled", { enabled: true });
    expect(invoke).not.toHaveBeenCalledWith("assistant_set_model", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("mcp_set_vault_allowed", expect.anything());
    expect(useAssistantStore.getState().enabled).not.toBe(true);

    render(
      <TooltipProvider>
        <AssistantToggle />
      </TooltipProvider>,
    );
    await waitFor(() => expect(useAssistantStore.getState().enabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Show assistant" })).toBeNull();
  });

  it("shows what's already set up when the tour is replayed", async () => {
    useVaultStore.setState({ currentVaultPath: RESEARCH });
    const anthropic = { ...provider("anthropic", "Anthropic", "key"), key: "keyring" as const };
    mockCommands({
      ...baseCommands,
      ...assistantCommands({
        enabled: true,
        model: { provider: "anthropic", model: MODELS[1].id, server: null },
        providers: [provider("openai", "OpenAI", "key"), anthropic, provider("local", "Local server", "local")],
      }),
    });
    render(
      <TooltipProvider>
        <Onboarding onDone={vi.fn()} onClose={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: copy.welcome.start }));
    await toAssistantStep();

    await screen.findByText(copy.assistant.on);
    expect(await screen.findByText("Opus 5.5")).toBeTruthy();
    expect(await screen.findByText(copy.assistant.vaultOn("Research"))).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("mcp_set_vault_allowed", {
      path: RESEARCH,
      allowed: true,
    });
    expect(invoke).not.toHaveBeenCalledWith("assistant_set_model", expect.anything());
    expect(screen.getByRole("button", { name: copy.common.continue })).toBeTruthy();
  });
});
