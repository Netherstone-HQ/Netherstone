// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_PREFERENCES, useSettingsStore } from "@/store/settings";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { openVaultDialog } from "@/lib/commands/vault";
import { openVault } from "@/lib/open-vault";
import { SETTINGS_CATEGORIES, SettingsPage } from "./SettingsPage";

const renderPage = () => render(<SettingsPage />, { wrapper: TooltipProvider });

const AI_APP = {
  id: "cursor",
  name: "Cursor",
  installed: true,
  connected: false,
  downloadUrl: "https://cursor.com/download",
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "ai_apps") return [AI_APP];
    if (command === "mcp_get_enabled") return false;
    if (command === "mcp_vaults") {
      return [{ path: "/v/Work", name: "Work", allowed: false }];
    }
    return null;
  }),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.1.0"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}));

vi.mock("@/lib/commands/vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commands/vault")>()),
  openVaultDialog: vi.fn(async () => null),
}));
vi.mock("@/lib/nested-vault", () => ({
  chooseVaultFolder: vi.fn(async (folder: string) => folder),
}));
vi.mock("@/lib/open-vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/open-vault")>()),
  openVault: vi.fn(async () => {}),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      renderPage();
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
    renderPage();
    fireEvent.click(screen.getByLabelText("Ask before moving to trash"));
    expect(useSettingsStore.getState().confirmBeforeDelete).toBe(false);
  });

  it("hides the recent shards count with its switch", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(useSettingsStore.getState().recentFilesLimit).toBe(4);
    fireEvent.click(screen.getByLabelText("Show recent shards"));
    expect(useSettingsStore.getState().showRecentFiles).toBe(false);
    expect(screen.queryByRole("group", { name: "Number of recent shards" })).toBeNull();
  });

  it("changes the theme", () => {
    useUIStore.setState({ settingsCategory: "appearance" });
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("connects an AI app and picks vaults once AI apps are on", async () => {
    useUIStore.setState({ settingsCategory: "ai-apps" });
    renderPage();
    const connect = await screen.findByRole("button", { name: "Connect" });
    const toggle = screen.getByLabelText("Connect your AI apps");
    await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
    expect(connect).toHaveProperty("disabled", true);

    fireEvent.click(toggle);
    expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", { enabled: true });
    fireEvent.click(connect);
    expect(invoke).toHaveBeenCalledWith("ai_app_connect", { id: "cursor" });
    fireEvent.click(screen.getByLabelText("Work"));
    expect(invoke).toHaveBeenCalledWith("mcp_set_vault_allowed", {
      path: "/v/Work",
      allowed: true,
    });
  });

  it("closes on Escape", () => {
    renderPage();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUIStore.getState().activeNavItem).toBeNull();
  });

  it("goes back to the editor after opening another vault", async () => {
    vi.mocked(openVaultDialog).mockResolvedValueOnce("/v/Other");
    useUIStore.setState({ settingsCategory: "vault", appMode: "canvas" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() =>
      expect(useUIStore.getState().activeNavItem).toBeNull(),
    );
    expect(openVault).toHaveBeenCalledWith("/v/Other");
    expect(useUIStore.getState().appMode).toBe("notes");
  });

  it("stays open when no folder is picked", async () => {
    useUIStore.setState({ settingsCategory: "vault" });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await waitFor(() => expect(openVaultDialog).toHaveResolved());
    expect(openVault).not.toHaveBeenCalled();
    expect(useUIStore.getState().activeNavItem).toBe("settings");
  });
});
