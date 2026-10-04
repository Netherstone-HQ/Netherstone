// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultSyncRecord } from "@/lib/sync";
import { useSyncStore } from "@/store/sync";
import { ConflictDialog } from "./ConflictDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const VAULT = "C:/Notes";
const CONFLICT = { path: "Projects/Plan.md", theirs: "abc", detectedAt: 1 };
const RECORD: VaultSyncRecord = {
  vaultId: "abc",
  vaultPath: VAULT,
  syncEnabled: true,
  remoteUrl: "https://github.com/octocat/Notes.git",
  repoName: "octocat/Notes",
  branch: "main",
  lastCommit: "1234",
  lastCommitAt: 1,
  lastSyncAt: 1,
  conflicts: [CONFLICT],
};

describe("ConflictDialog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      switch (command) {
        case "sync_get_conflict_versions":
          return {
            path: CONFLICT.path,
            thisDevice: "# Plan\nmine",
            github: "# Plan\ntheirs",
            thisDeviceBytes: 12,
            githubBytes: 14,
          };
        case "sync_resolve_conflict":
          return { ...RECORD, conflicts: [] };
        case "sync_now":
          return { record: { ...RECORD, conflicts: [] }, changed: [] };
      }
    });
    useSyncStore.setState({
      vaultPath: VAULT,
      record: RECORD,
      loaded: true,
      isWorking: false,
      offline: false,
      error: null,
      openConflict: CONFLICT,
    });
  });

  afterEach(cleanup);

  it("previews both versions and keeps both", async () => {
    render(<ConflictDialog vaultPath={VAULT} />);
    expect(screen.getByText("Choose which version to keep")).toBeTruthy();
    expect(await screen.findByText(/mine/)).toBeTruthy();
    expect(screen.getByText(/theirs/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /keep both/i }));

    await vi.waitFor(() => expect(useSyncStore.getState().openConflict).toBeNull());
    expect(invoke).toHaveBeenCalledWith("sync_resolve_conflict", {
      vaultPath: VAULT,
      path: CONFLICT.path,
      choice: "both",
    });
    expect(invoke).toHaveBeenCalledWith("sync_now", { vaultPath: VAULT });
    expect(useSyncStore.getState().record?.conflicts).toEqual([]);
  });
});
