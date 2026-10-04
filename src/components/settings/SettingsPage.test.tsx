// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { SETTINGS_CATEGORIES, SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.0"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...DEFAULT_PREFERENCES });
    useVaultStore.setState({ currentVaultPath: null });
    useUIStore.setState({
      activeNavItem: "settings",
      settingsCategory: "general",
    });
  });
  afterEach(cleanup);

  it.each(SETTINGS_CATEGORIES.map((c) => [c.label, c.id] as const))(
    "shows %s when picked",
    (label, id) => {
      render(<SettingsPage />);
      const nav = screen.getByRole("navigation", { name: "Settings" });
      fireEvent.click(
        Array.from(nav.querySelectorAll("button")).find(
          (b) => b.textContent === label,
        )!,
      );
      expect(useUIStore.getState().settingsCategory).toBe(id);
      expect(
        screen.getByRole("heading", { level: 2, name: label }),
      ).toBeTruthy();
    },
  );

  it("changes a preference from its switch", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByLabelText("Ask before moving to Trash"));
    expect(useSettingsStore.getState().confirmBeforeDelete).toBe(false);
  });

  it("hides the recent shards count with its switch", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(useSettingsStore.getState().recentFilesLimit).toBe(4);
    fireEvent.click(screen.getByLabelText("Show recent shards"));
    expect(useSettingsStore.getState().showRecentFiles).toBe(false);
    expect(screen.queryByRole("group", { name: "Number of recent shards" })).toBeNull();
  });

  it("changes the theme", () => {
    useUIStore.setState({ settingsCategory: "appearance" });
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("closes on Escape", () => {
    render(<SettingsPage />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().activeNavItem).toBeNull();
  });
});
