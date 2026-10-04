// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORE_KEY = "netherstone-settings";
const LEGACY_STORE_KEY = "netherite-settings";

async function loadStore() {
  vi.resetModules();
  const mod = await import("./settings");
  await mod.useSettingsStore.persist.rehydrate();
  return mod;
}

describe("settings store", () => {
  beforeEach(() => localStorage.clear());

  it("starts from the defaults", async () => {
    const { useSettingsStore, DEFAULT_PREFERENCES } = await loadStore();
    expect(useSettingsStore.getState()).toMatchObject(DEFAULT_PREFERENCES);
    expect(useSettingsStore.getState().onboardingCompletedAt).toBeNull();
  });

  it("keeps preferences within their allowed values", async () => {
    const { useSettingsStore } = await loadStore();
    const { setPreference } = useSettingsStore.getState();
    setPreference("recentFilesLimit", 99);
    setPreference("autoSyncInterval", 7 as never);
    expect(useSettingsStore.getState().recentFilesLimit).toBe(20);
    expect(useSettingsStore.getState().autoSyncInterval).toBe(5);
  });

  it("carries over the theme saved before it moved here", async () => {
    localStorage.setItem("vite-ui-theme", "light");
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("carries over the theme when upgrading older saved settings", async () => {
    localStorage.setItem("vite-ui-theme", "system");
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ state: { recentFilesLimit: 7 }, version: 0 }),
    );
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState()).toMatchObject({
      theme: "system",
      recentFilesLimit: 7,
    });
  });

  it("turns a hidden Recent list (count 0) into the switch", async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ state: { recentFilesLimit: 0 }, version: 1 }),
    );
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState()).toMatchObject({
      showRecentFiles: false,
      recentFilesLimit: 3,
    });
  });

  it("moves settings saved under the old Netherite key", async () => {
    localStorage.setItem(
      LEGACY_STORE_KEY,
      JSON.stringify({
        state: { theme: "light", onboardingCompletedAt: "2026-10-04T12:00:00Z" },
        version: 2,
      }),
    );
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState()).toMatchObject({
      theme: "light",
      onboardingCompletedAt: "2026-10-04T12:00:00Z",
    });
    expect(localStorage.getItem(LEGACY_STORE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}").state.theme).toBe(
      "light",
    );
  });

  it("still upgrades older settings saved under the old key", async () => {
    localStorage.setItem(
      LEGACY_STORE_KEY,
      JSON.stringify({ state: { recentFilesLimit: 0 }, version: 1 }),
    );
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState()).toMatchObject({
      showRecentFiles: false,
      recentFilesLimit: 3,
    });
  });

  it("prefers settings under the new key over the old one", async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ state: { theme: "system" }, version: 2 }),
    );
    localStorage.setItem(
      LEGACY_STORE_KEY,
      JSON.stringify({ state: { theme: "light" }, version: 2 }),
    );
    const { useSettingsStore } = await loadStore();
    expect(useSettingsStore.getState().theme).toBe("system");
  });

  it("resets preferences without showing onboarding again", async () => {
    const { useSettingsStore, DEFAULT_PREFERENCES } = await loadStore();
    const state = useSettingsStore.getState();
    state.completeOnboarding();
    state.setTheme("light");
    state.resetSettings();
    expect(useSettingsStore.getState().theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(useSettingsStore.getState().onboardingCompletedAt).not.toBeNull();

    useSettingsStore.getState().resetOnboarding();
    expect(useSettingsStore.getState().onboardingCompletedAt).toBeNull();
  });

  it("saves onboarding and preferences, not actions", async () => {
    const { useSettingsStore } = await loadStore();
    useSettingsStore.getState().completeOnboarding();
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    expect(saved.version).toBe(2);
    expect(saved.state.onboardingCompletedAt).toEqual(expect.any(String));
    expect(saved.state.theme).toBe("dark");
    expect(saved.state.setTheme).toBeUndefined();
  });

  it("recognizes beta versions", async () => {
    const { isPrerelease } = await loadStore();
    expect(isPrerelease("0.2.0")).toBe(false);
    expect(isPrerelease("0.2.0-beta.1")).toBe(true);
  });
});
