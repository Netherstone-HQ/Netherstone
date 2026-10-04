// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncPlanSummary, VaultSyncRecord } from "@/lib/sync";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";
import { BackupPanel } from "./BackupPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const VAULT = "C:/Notes";
const ACCOUNT = { login: "octocat", name: "The Octocat", avatarUrl: null };

const PLAN: SyncPlanSummary = {
  includedCount: 3,
  shardCount: 2,
  drawingCount: 0,
  attachmentCount: 1,
  includedBytes: 2048,
  skipped: [
    { path: "_attachments/movie.mp4", sizeBytes: 50 * 1024 * 1024, reason: "localOnly" },
    { path: "_attachments/setup.exe", sizeBytes: 10, reason: "blocked" },
  ],
};

const RECORD: VaultSyncRecord = {
  vaultId: "abc",
  vaultPath: VAULT,
  syncEnabled: true,
  remoteUrl: "https://github.com/octocat/Notes.git",
  repoName: "octocat/Notes",
  branch: "main",
  lastCommit: "1234",
  lastCommitAt: 1,
  lastSyncAt: Math.floor(Date.now() / 1000) - 60,
  conflicts: [],
};

function mockCommands(handlers: Record<string, () => Promise<unknown>>) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    const handler = handlers[command];
    return handler ? handler() : undefined;
  });
}

describe("BackupPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useGitHubStore.setState({
      account: null,
      loaded: false,
      signIn: { kind: "idle" },
      error: null,
      installation: null,
      installationError: null,
    });
    useSyncStore.setState({
      vaultPath: null,
      record: null,
      loaded: false,
      plan: null,
      isWorking: false,
      offline: false,
      error: null,
      backups: null,
      openConflict: null,
    });
  });

  afterEach(cleanup);

  it("asks to sign in first", async () => {
    mockCommands({
      github_get_account: async () => null,
      sync_get_vault_record: async () => null,
      sync_plan_vault: async () => PLAN,
    });

    render(<BackupPanel vaultPath={VAULT} />);
    expect(await screen.findByRole("button", { name: /connect github/i })).toBeTruthy();
  });

  it("previews the backup, then turns it on", async () => {
    let finishTurnOn!: (report: { record: VaultSyncRecord; changed: string[] }) => void;
    mockCommands({
      github_get_account: async () => ACCOUNT,
      github_get_installation: async () => ({ installed: true, installedOn: ["wSoltani"], installUrl: "" }),
      sync_get_vault_record: async () => null,
      sync_plan_vault: async () => PLAN,
      sync_turn_on_backup: () =>
        new Promise((resolve) => {
          finishTurnOn = resolve;
        }),
    });

    render(<BackupPanel vaultPath={VAULT} />);
    expect(
      await screen.findByText(/2 shards and 1 attachment/),
    ).toBeTruthy();
    expect(screen.getByText("@octocat")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /2 files stay on this device/i }));
    expect(screen.getByText("movie.mp4")).toBeTruthy();
    expect(screen.getByText("Larger than 20 MB")).toBeTruthy();
    expect(screen.getByText("Program files aren't backed up")).toBeTruthy();

    const turnOn = screen.getByRole("button", { name: /turn on sync/i });
    await vi.waitFor(() => expect(turnOn).toHaveProperty("disabled", false));
    fireEvent.click(turnOn);
    expect(await screen.findByRole("button", { name: /setting up/i })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("sync_turn_on_backup", { vaultPath: VAULT });

    await act(async () => finishTurnOn({ record: RECORD, changed: [] }));
    expect(await screen.findByText(/synced 1 minute ago/i)).toBeTruthy();
    expect(screen.getByText("octocat/Notes")).toBeTruthy();
  });

  it("asks to install the GitHub App before turning backup on", async () => {
    mockCommands({
      github_get_account: async () => ACCOUNT,
      github_get_installation: async () => ({
        installed: false,
        installedOn: ["Netherstone-HQ"],
        installUrl: "https://github.com/apps/netherstone-app/installations/new",
      }),
      sync_get_vault_record: async () => null,
      sync_plan_vault: async () => PLAN,
    });

    render(<BackupPanel vaultPath={VAULT} />);
    expect(await screen.findByRole("button", { name: /install on github/i })).toBeTruthy();
    expect(
      screen.getByText(/installed on Netherstone-HQ, but backups go to your personal account\. Install it on @octocat/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /turn on sync/i })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows when it's working offline", async () => {
    mockCommands({
      github_get_account: async () => ACCOUNT,
      sync_get_vault_record: async () => RECORD,
      sync_now: async () => {
        throw "Couldn't reach GitHub. Check your internet connection and try again.";
      },
    });

    render(<BackupPanel vaultPath={VAULT} />);
    fireEvent.click(await screen.findByRole("button", { name: /sync now/i }));
    expect(await screen.findByText(/working offline/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /sync now/i })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("shows other sync errors", async () => {
    mockCommands({
      github_get_account: async () => ACCOUNT,
      sync_get_vault_record: async () => RECORD,
      sync_now: async () => {
        throw "GitHub didn't accept the connection. Reconnect GitHub in Settings.";
      },
    });

    render(<BackupPanel vaultPath={VAULT} />);
    fireEvent.click(await screen.findByRole("button", { name: /sync now/i }));
    expect(await screen.findByText(/reconnect github/i)).toBeTruthy();
  });

  it("lists files that need a decision", async () => {
    const conflict = { path: "Projects/Plan.md", theirs: "abc", detectedAt: 1 };
    mockCommands({
      github_get_account: async () => ACCOUNT,
      sync_get_vault_record: async () => ({ ...RECORD, conflicts: [conflict] }),
    });

    render(<BackupPanel vaultPath={VAULT} />);
    expect(await screen.findByText(/1 file needs a decision/i)).toBeTruthy();
    expect(screen.getByText("Plan.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /choose/i }));
    expect(useSyncStore.getState().openConflict).toEqual(conflict);
  });

  it("connects the vault to an existing backup", async () => {
    const backup = {
      fullName: "octocat/Notes",
      name: "Notes",
      cloneUrl: "https://github.com/octocat/Notes.git",
      pushedAt: new Date().toISOString(),
    };
    mockCommands({
      github_get_account: async () => ACCOUNT,
      github_get_installation: async () => ({ installed: true, installedOn: ["octocat"], installUrl: "" }),
      sync_get_vault_record: async () => null,
      sync_plan_vault: async () => ({ ...PLAN, includedCount: 0, skipped: [] }),
      sync_list_backups: async () => [backup],
      sync_connect_backup: async () => ({ record: RECORD, changed: [] }),
    });

    render(<BackupPanel vaultPath={VAULT} />);
    fireEvent.click(await screen.findByRole("button", { name: /use that backup/i }));
    expect(await screen.findByText(/download into this vault/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /notes/i }));

    expect(await screen.findByText(/synced 1 minute ago/i)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("sync_connect_backup", {
      vaultPath: VAULT,
      fullName: "octocat/Notes",
      cloneUrl: "https://github.com/octocat/Notes.git",
    });
  });
});
