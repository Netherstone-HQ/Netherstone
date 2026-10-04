// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdate = vi.fn();
const installUpdate = vi.fn();

vi.mock("@/lib/updates", () => ({
  checkForUpdate: (beta: boolean) => checkForUpdate(beta),
  installUpdate: () => installUpdate(),
}));

const update = { version: "0.2.0", currentVersion: "0.1.0", notes: null };

async function loadStores() {
  vi.resetModules();
  const { useSettingsStore } = await import("./settings");
  const { useUpdatesStore } = await import("./updates");
  // Start on stable, whatever this build's version defaults to.
  useSettingsStore.getState().setPreference("betaUpdates", false);
  return { useSettingsStore, useUpdatesStore };
}

describe("updates store", () => {
  beforeEach(() => {
    localStorage.clear();
    checkForUpdate.mockReset();
    installUpdate.mockReset();
  });

  it("checks the channel chosen in Settings", async () => {
    const { useSettingsStore, useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(null);

    await useUpdatesStore.getState().check();
    useSettingsStore.getState().setPreference("betaUpdates", true);
    await useUpdatesStore.getState().check();

    expect(checkForUpdate.mock.calls).toEqual([[false], [true]]);
  });

  it("reports an available update, or that there is none", async () => {
    const { useUpdatesStore } = await loadStores();

    checkForUpdate.mockResolvedValueOnce(update);
    await expect(useUpdatesStore.getState().check()).resolves.toEqual(update);
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "available",
      update,
    });

    checkForUpdate.mockResolvedValueOnce(null);
    await useUpdatesStore.getState().check();
    expect(useUpdatesStore.getState().status).toEqual({ kind: "up-to-date" });
  });

  it("keeps the error when a check fails", async () => {
    const { useUpdatesStore } = await loadStores();
    checkForUpdate.mockRejectedValue("offline");

    await expect(useUpdatesStore.getState().check()).resolves.toBeNull();
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "error",
      message: "offline",
    });
  });

  it("forgets the last result when the channel changes", async () => {
    const { useSettingsStore, useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(update);
    await useUpdatesStore.getState().check();

    useSettingsStore.getState().setPreference("betaUpdates", true);

    expect(useUpdatesStore.getState().status).toEqual({ kind: "idle" });
  });

  it("ignores a check that a channel change overtook", async () => {
    const { useSettingsStore, useUpdatesStore } = await loadStores();
    let finish: (value: unknown) => void = () => {};
    checkForUpdate.mockReturnValue(new Promise((r) => (finish = r)));

    const pending = useUpdatesStore.getState().check();
    useSettingsStore.getState().setPreference("betaUpdates", true);
    finish(update);
    await pending;

    expect(useUpdatesStore.getState().status).toEqual({ kind: "idle" });
  });

  it("installs only an available update, and reports a failure", async () => {
    const { useUpdatesStore } = await loadStores();
    await useUpdatesStore.getState().install();
    expect(installUpdate).not.toHaveBeenCalled();

    checkForUpdate.mockResolvedValue(update);
    await useUpdatesStore.getState().check();
    installUpdate.mockRejectedValue("download failed");

    await expect(useUpdatesStore.getState().install()).rejects.toBe(
      "download failed",
    );
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "error",
      message: "download failed",
    });
  });
});
