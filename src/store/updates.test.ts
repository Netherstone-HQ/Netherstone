// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdate = vi.fn();
const downloadUpdate = vi.fn();
const installUpdate = vi.fn();
const saveBeforeQuit = vi.fn();

vi.mock("@/lib/updates", () => ({
  checkForUpdate: (beta: boolean) => checkForUpdate(beta),
  downloadUpdate: (onProgress: (percent: number) => void) =>
    downloadUpdate(onProgress),
  installUpdate: () => installUpdate(),
}));

vi.mock("@/hooks/useAutosave", () => ({
  saveBeforeQuit: () => saveBeforeQuit(),
}));

const update = { version: "0.2.0", currentVersion: "0.1.0", notes: null };

async function loadStores() {
  vi.resetModules();
  const { useSettingsStore } = await import("./settings");
  const { useUpdatesStore } = await import("./updates");
  const { useEditorStore } = await import("./editor");
  // Start on stable, whatever this build's version defaults to.
  useSettingsStore.getState().setPreference("betaUpdates", false);
  return { useEditorStore, useSettingsStore, useUpdatesStore };
}

/** A download that runs until the test finishes it. */
function holdDownload() {
  let onStart: () => void = () => {};
  let finish: () => void = () => {};
  const started = new Promise<void>((resolve) => (onStart = resolve));
  return {
    started,
    start: () => {
      onStart();
      return new Promise<void>((resolve) => (finish = resolve));
    },
    finish: () => finish(),
  };
}

describe("updates store", () => {
  beforeEach(() => {
    localStorage.clear();
    checkForUpdate.mockReset();
    downloadUpdate.mockReset().mockResolvedValue(undefined);
    installUpdate.mockReset();
    saveBeforeQuit.mockReset().mockResolvedValue(undefined);
  });

  it("checks the channel chosen in Settings", async () => {
    const { useSettingsStore, useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(null);

    await useUpdatesStore.getState().check();
    useSettingsStore.getState().setPreference("betaUpdates", true);
    await useUpdatesStore.getState().check();

    expect(checkForUpdate.mock.calls).toEqual([[false], [true]]);
  });

  it("downloads an available update, or reports that there is none", async () => {
    const { useUpdatesStore } = await loadStores();
    const download = holdDownload();
    downloadUpdate.mockImplementation((onProgress: (p: number) => void) => {
      onProgress(42);
      return download.start();
    });

    checkForUpdate.mockResolvedValueOnce(update);
    const checked = useUpdatesStore.getState().check();
    await download.started;
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "downloading",
      update,
      percent: 42,
    });

    download.finish();
    await expect(checked).resolves.toEqual(update);
    expect(useUpdatesStore.getState().status).toEqual({ kind: "ready", update });

    checkForUpdate.mockResolvedValueOnce(null);
    await useUpdatesStore.getState().check();
    expect(useUpdatesStore.getState().status).toEqual({ kind: "up-to-date" });
  });

  it("keeps the error when a download fails", async () => {
    const { useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(update);
    downloadUpdate.mockRejectedValue("offline");

    await useUpdatesStore.getState().check();

    expect(useUpdatesStore.getState().status).toEqual({
      kind: "error",
      failed: "download",
      message: "offline",
    });
  });

  it("keeps the error when a check fails", async () => {
    const { useUpdatesStore } = await loadStores();
    checkForUpdate.mockRejectedValue("offline");

    await expect(useUpdatesStore.getState().check()).resolves.toBeNull();
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "error",
      failed: "check",
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

  it("ignores a download that a channel change overtook", async () => {
    const { useSettingsStore, useUpdatesStore } = await loadStores();
    const download = holdDownload();
    checkForUpdate.mockResolvedValue(update);
    downloadUpdate.mockImplementation(() => download.start());

    const checked = useUpdatesStore.getState().check();
    await download.started;
    useSettingsStore.getState().setPreference("betaUpdates", true);
    download.finish();
    await checked;

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

  it("saves open work, then installs only a downloaded update", async () => {
    const { useUpdatesStore } = await loadStores();
    await useUpdatesStore.getState().install();
    expect(installUpdate).not.toHaveBeenCalled();

    checkForUpdate.mockResolvedValue(update);
    await useUpdatesStore.getState().check();
    expect(useUpdatesStore.getState().status.kind).toBe("ready");
    const order: string[] = [];
    saveBeforeQuit.mockImplementation(async () => order.push("save"));
    installUpdate.mockImplementation(async () => order.push("install"));

    await useUpdatesStore.getState().install();

    expect(order).toEqual(["save", "install"]);
  });

  it("waits for the choice about an outside change before installing", async () => {
    const { useEditorStore, useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(update);
    await useUpdatesStore.getState().check();
    expect(useUpdatesStore.getState().status.kind).toBe("ready");
    useEditorStore
      .getState()
      .setOutsideChange({ path: "a.md", mine: "mine", outside: "theirs" });

    await expect(useUpdatesStore.getState().install()).rejects.toThrow();

    expect(saveBeforeQuit).not.toHaveBeenCalled();
    expect(installUpdate).not.toHaveBeenCalled();
    expect(useUpdatesStore.getState().status).toEqual({ kind: "ready", update });
  });

  it("reports a failed install", async () => {
    const { useUpdatesStore } = await loadStores();
    checkForUpdate.mockResolvedValue(update);
    await useUpdatesStore.getState().check();
    expect(useUpdatesStore.getState().status.kind).toBe("ready");
    installUpdate.mockRejectedValue("install failed");

    await expect(useUpdatesStore.getState().install()).rejects.toBe(
      "install failed",
    );
    expect(useUpdatesStore.getState().status).toEqual({
      kind: "error",
      failed: "install",
      message: "install failed",
    });
  });
});
