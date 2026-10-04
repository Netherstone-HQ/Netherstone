// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("renamed store keys", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the open vault saved under the old Netherite key", async () => {
    localStorage.setItem(
      "netherite-vault",
      JSON.stringify({ state: { currentVaultPath: "C:/Vaults/Mine" }, version: 0 }),
    );
    vi.resetModules();
    const { useVaultStore } = await import("./vault");
    await useVaultStore.persist.rehydrate();
    expect(useVaultStore.getState().currentVaultPath).toBe("C:/Vaults/Mine");
    expect(localStorage.getItem("netherite-vault")).toBeNull();
    expect(localStorage.getItem("netherstone-vault")).toContain("C:/Vaults/Mine");
  });

  it("keeps the layout saved under the old Netherite key", async () => {
    localStorage.setItem(
      "netherite-ui",
      JSON.stringify({ state: { isSidebarOpen: false, sidebarWidth: 320 }, version: 0 }),
    );
    vi.resetModules();
    const { useUIStore } = await import("./ui");
    await useUIStore.persist.rehydrate();
    expect(useUIStore.getState()).toMatchObject({
      isSidebarOpen: false,
      sidebarWidth: 320,
    });
    expect(localStorage.getItem("netherite-ui")).toBeNull();
  });
});
