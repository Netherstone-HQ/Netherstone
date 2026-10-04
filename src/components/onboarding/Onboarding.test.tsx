// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openEditorFile } from "@/lib/open-editor-file";
import { useVaultStore } from "@/store";
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

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function mockCommands(handlers: Handlers) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const handler = handlers[command];
    return handler ? handler((args ?? {}) as Record<string, unknown>) : undefined;
  });
}

const baseCommands: Handlers = {
  default_vault_location: () => DOCUMENTS,
  scan_vault: () => [],
  sync_get_vault_record: () => null,
  github_get_account: () => null,
};

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

    fireEvent.click(screen.getByRole("radio", { name: copy.appearance.options.light }));
    expect(useSettingsStore.getState().theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));

    await screen.findByText(copy.sync.title);
    fireEvent.click(screen.getByRole("button", { name: copy.common.skip }));

    await screen.findByText(copy.ready.bodyNewVault);
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
    useVaultStore.setState({ currentVaultPath: "/vaults/Research" });
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
    expect(screen.getByText(copy.sync.explainer[0])).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.common.continue }));

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
});
