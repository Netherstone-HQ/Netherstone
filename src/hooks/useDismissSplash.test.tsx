// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVaultStore } from "@/store";
import { scanVault } from "@/lib/commands";
import { dismissSplash } from "@/lib/splash";
import { useVaultInit } from "./useVaultInit";
import { useDismissSplash } from "./useDismissSplash";

vi.mock("@/lib/commands", () => ({ scanVault: vi.fn() }));
vi.mock("@/lib/splash", () => ({ dismissSplash: vi.fn() }));

function Shell() {
  useVaultInit();
  useDismissSplash();
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useVaultStore.setState({ currentVaultPath: null, isVaultLoading: false });
});

describe("useDismissSplash", () => {
  it("lifts the splash right away when there is no vault to load", () => {
    render(<Shell />);
    expect(dismissSplash).toHaveBeenCalled();
  });

  it("waits for the last vault to be read back first", async () => {
    let finishScan: (tree: []) => void = () => {};
    vi.mocked(scanVault).mockReturnValue(
      new Promise((resolve) => (finishScan = resolve)),
    );
    useVaultStore.setState({ currentVaultPath: "/vaults/splash-test" });

    render(<Shell />);
    expect(dismissSplash).not.toHaveBeenCalled();

    await act(async () => finishScan([]));
    expect(dismissSplash).toHaveBeenCalled();
  });
});
