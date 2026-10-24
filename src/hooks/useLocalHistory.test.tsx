// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveVaultVersion } from "@/lib/sync";
import { useVaultStore } from "@/store/vault";
import {
  useLocalHistory,
  VERSION_CAP_MS,
  VERSION_DELAY_MS,
} from "./useLocalHistory";

let changed: (() => void) | undefined;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    changed = handler;
    return () => {
      changed = undefined;
    };
  }),
}));

vi.mock("@/lib/sync", () => ({
  saveVaultVersion: vi.fn(async () => {}),
}));

const VAULT = "C:/vault";

async function openVault() {
  useVaultStore.setState({ currentVaultPath: VAULT });
  const hook = renderHook(() => useLocalHistory());
  // Lets the listener register.
  await act(async () => {});
  return hook;
}

describe("useLocalHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveVaultVersion).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useVaultStore.setState({ currentVaultPath: null });
  });

  it("saves a version a minute after changes stop", async () => {
    await openVault();
    changed?.();
    vi.advanceTimersByTime(VERSION_DELAY_MS - 1);
    changed?.();
    vi.advanceTimersByTime(VERSION_DELAY_MS - 1);
    expect(saveVaultVersion).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(saveVaultVersion).toHaveBeenCalledTimes(1);
    expect(saveVaultVersion).toHaveBeenCalledWith(VAULT);
  });

  it("saves one every ten minutes while changes keep coming", async () => {
    await openVault();
    // A change every 30 seconds for 25 minutes.
    for (let elapsed = 0; elapsed < 25 * 60_000; elapsed += 30_000) {
      changed?.();
      vi.advanceTimersByTime(30_000);
    }
    expect(saveVaultVersion).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(VERSION_DELAY_MS);
    expect(saveVaultVersion).toHaveBeenCalledTimes(3);
  });

  it("counts the ten minutes from the first change after a version", async () => {
    await openVault();
    vi.advanceTimersByTime(VERSION_DELAY_MS);
    expect(saveVaultVersion).toHaveBeenCalledTimes(1);

    // Quiet for a while, then steady changes: the cap starts with them.
    vi.advanceTimersByTime(VERSION_CAP_MS);
    for (let elapsed = 0; elapsed < VERSION_CAP_MS - 30_000; elapsed += 30_000) {
      changed?.();
      vi.advanceTimersByTime(30_000);
    }
    expect(saveVaultVersion).toHaveBeenCalledTimes(1);
    changed?.();
    vi.advanceTimersByTime(30_000);
    expect(saveVaultVersion).toHaveBeenCalledTimes(2);
  });

  it("saves the pending version when the vault closes", async () => {
    const hook = await openVault();
    changed?.();
    hook.unmount();
    expect(saveVaultVersion).toHaveBeenCalledTimes(1);
  });
});
