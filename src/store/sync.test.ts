import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncNow, type SyncConflict, type VaultSyncRecord } from "@/lib/sync";
import { useSyncStore } from "@/store/sync";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

vi.mock("@/lib/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync")>()),
  syncNow: vi.fn(),
}));

vi.mock("@/lib/sync-refresh", () => ({
  prepareForSync: async () => true,
  showSyncedChanges: async () => {},
}));

const VAULT = "C:/vault";

const conflict = (path: string): SyncConflict => ({
  path,
  theirs: "abc",
  detectedAt: 1,
});

const record = (conflicts: SyncConflict[]): VaultSyncRecord => ({
  vaultId: "v",
  vaultPath: VAULT,
  syncEnabled: true,
  remoteUrl: null,
  repoName: null,
  branch: "main",
  lastCommit: null,
  lastCommitAt: null,
  lastSyncAt: null,
  conflicts,
});

async function syncWith(conflicts: SyncConflict[]) {
  vi.mocked(syncNow).mockResolvedValue({ record: record(conflicts), changed: [] });
  await useSyncStore.getState().sync(VAULT);
}

afterEach(() => {
  useSyncStore.setState({ vaultPath: null, record: null, openConflict: null });
  vi.clearAllMocks();
});

describe("sync conflicts", () => {
  it("says which file changed on two devices, with Review opening it", async () => {
    useSyncStore.setState({ vaultPath: VAULT, record: record([]) });
    await syncWith([conflict("Notes/Hub.md")]);

    expect(toast.warning).toHaveBeenCalledWith(
      "Hub changed on two devices",
      expect.anything(),
    );
    const { action } = vi.mocked(toast.warning).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    action.onClick();
    expect(useSyncStore.getState().openConflict?.path).toBe("Notes/Hub.md");
  });

  it("counts several files", async () => {
    useSyncStore.setState({ vaultPath: VAULT, record: record([]) });
    await syncWith([conflict("A.md"), conflict("B.md")]);

    expect(toast.warning).toHaveBeenCalledWith(
      "2 files changed on two devices",
      expect.anything(),
    );
  });

  it("doesn't repeat files it already said", async () => {
    useSyncStore.setState({ vaultPath: VAULT, record: record([conflict("A.md")]) });
    await syncWith([conflict("A.md")]);

    expect(toast.warning).not.toHaveBeenCalled();
  });
});
