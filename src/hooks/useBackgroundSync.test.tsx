// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncBeforeQuit } from "@/lib/sync-before-quit";
import type { VaultSyncRecord } from "@/lib/sync";
import { useEditorStore } from "@/store/editor";
import { useGitHubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { useSyncStore } from "@/store/sync";
import { useVaultStore } from "@/store/vault";
import { useBackgroundSync } from "./useBackgroundSync";

type Changed = (event: { payload: { paths: string[] } }) => void;
let changed: Changed | undefined;
let focusChanged: ((event: { payload: boolean }) => void) | undefined;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: Changed) => {
    changed = handler;
    return () => {
      changed = undefined;
    };
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn(
      async (handler: (event: { payload: boolean }) => void) => {
        focusChanged = handler;
        return () => {
          focusChanged = undefined;
        };
      },
    ),
  }),
}));

vi.mock("@/lib/drawing-files", () => ({
  hasPendingDrawingSave: () => false,
}));

const VAULT = "C:/vault";
const MINUTE = 60_000;
const INTERVAL = 30 * MINUTE;
const sync = vi.fn(async () => {
  // A finished sync moves the last sync time, like the real one.
  const record = useSyncStore.getState().record;
  useSyncStore.setState({
    record: { ...record!, lastSyncAt: Math.floor(Date.now() / 1000) },
  });
  return true;
});

async function openVault() {
  useSyncStore.setState({
    vaultPath: VAULT,
    record: { syncEnabled: true, lastSyncAt: null } as VaultSyncRecord,
    sync,
  });
  useVaultStore.setState({ currentVaultPath: VAULT });
  const hook = renderHook(() => useBackgroundSync());
  // Lets the listeners register.
  await act(async () => {});
  // The sync right after the vault opens.
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(sync).toHaveBeenCalledTimes(1);
  sync.mockClear();
  return hook;
}

/** A file in the vault changed on disk. */
const edit = (path = `${VAULT}/Notes.md`) => changed?.({ payload: { paths: [path] } });
const leave = () => focusChanged?.({ payload: false });
const comeBack = () => focusChanged?.({ payload: true });

describe("useBackgroundSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sync.mockClear();
    useGitHubStore.setState({ account: {} as never, loaded: true });
    useSettingsStore.setState({ autoSync: true, autoSyncInterval: 30 });
    useEditorStore.setState({ isDirty: false });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useVaultStore.setState({ currentVaultPath: null });
  });

  it("syncs at most once per interval when leaving and coming back", async () => {
    await openVault();
    vi.advanceTimersByTime(INTERVAL);
    edit();
    leave();
    expect(sync).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    comeBack();
    edit();
    leave();
    expect(sync).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVAL - 20_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("doesn't sync on leaving without edits", async () => {
    await openVault();
    vi.advanceTimersByTime(INTERVAL);
    leave();
    vi.advanceTimersByTime(INTERVAL);
    expect(sync).not.toHaveBeenCalled();
  });

  it("syncs edits within an interval while the window stays open", async () => {
    await openVault();
    vi.advanceTimersByTime(INTERVAL);
    edit();
    vi.advanceTimersByTime(INTERVAL - 1);
    edit();
    expect(sync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("syncs before quitting only while edits wait", async () => {
    await openVault();
    expect(syncBeforeQuit()).toBeNull();

    useEditorStore.setState({ isDirty: true });
    await syncBeforeQuit()?.();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("doesn't count files a sync brought in as edits", async () => {
    await openVault();
    // The sync's own write, as the store notes it.
    useSyncStore.setState({
      notWrittenBySync: (paths) => paths.filter((path) => path !== `${VAULT}/Pulled.md`),
    });
    vi.advanceTimersByTime(INTERVAL);
    edit(`${VAULT}/Pulled.md`);
    leave();
    vi.advanceTimersByTime(INTERVAL);
    expect(sync).not.toHaveBeenCalled();
    expect(syncBeforeQuit()).toBeNull();

    edit();
    leave();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("keeps edits a failed sync didn't take for quitting", async () => {
    await openVault();
    vi.advanceTimersByTime(INTERVAL);
    sync.mockResolvedValueOnce(false);
    edit();
    leave();
    await act(async () => {});
    expect(sync).toHaveBeenCalledTimes(1);

    await syncBeforeQuit()?.();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("stops when automatic sync is off", async () => {
    await openVault();
    act(() => useSettingsStore.setState({ autoSync: false }));
    edit();
    comeBack();
    vi.advanceTimersByTime(INTERVAL);
    expect(sync).not.toHaveBeenCalled();
    expect(syncBeforeQuit()).toBeNull();
  });
});
