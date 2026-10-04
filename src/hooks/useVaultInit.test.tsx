// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorStore, useSettingsStore, useUIStore, useVaultStore } from "@/store";
import { scanVault } from "@/lib/commands";
import { openMarkdownFile } from "@/lib/editor-ast-cache";
import { useVaultInit } from "./useVaultInit";

vi.mock("@/lib/commands", () => ({ scanVault: vi.fn() }));
vi.mock("@/lib/editor-ast-cache", () => ({ openMarkdownFile: vi.fn() }));

function Shell() {
  useVaultInit();
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useVaultStore.setState({ currentVaultPath: null, isVaultLoading: false });
  useUIStore.setState({ recentFiles: [] });
  useEditorStore.setState({ openingFilePath: null });
  useSettingsStore.setState({ reopenLastShard: true });
});

describe("useVaultInit", () => {
  it("starts reopening the last shard on mount, without waiting for the scan", () => {
    vi.mocked(scanVault).mockReturnValue(new Promise(() => {}));
    vi.mocked(openMarkdownFile).mockReturnValue(new Promise(() => {}));
    useVaultStore.setState({ currentVaultPath: "/vaults/reopen" });
    useUIStore.setState({
      recentFiles: [{ path: "/vaults/reopen/Notes.md", name: "Notes.md" }],
    });

    render(<Shell />);

    // Set by the time the first render is on screen, so the editor shows the
    // shard on its way instead of "No shard open".
    expect(useEditorStore.getState().openingFilePath).toBe(
      "/vaults/reopen/Notes.md",
    );
  });

  it("leaves the editor empty when reopening is turned off", () => {
    vi.mocked(scanVault).mockReturnValue(new Promise(() => {}));
    useSettingsStore.setState({ reopenLastShard: false });
    useVaultStore.setState({ currentVaultPath: "/vaults/no-reopen" });
    useUIStore.setState({
      recentFiles: [{ path: "/vaults/no-reopen/Notes.md", name: "Notes.md" }],
    });

    render(<Shell />);

    expect(useEditorStore.getState().openingFilePath).toBeNull();
    expect(openMarkdownFile).not.toHaveBeenCalled();
  });
});
