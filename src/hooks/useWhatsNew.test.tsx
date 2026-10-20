// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/store";
import { useSettingsStore } from "@/store/settings";
import { canUpdate } from "@/lib/updates";
import { changelogUrl, useWhatsNew } from "./useWhatsNew";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/lib/updates", () => ({ canUpdate: vi.fn(() => true) }));

const version = __APP_VERSION__;

function Shell() {
  useWhatsNew();
  return null;
}

async function launch() {
  render(<Shell />);
  // Let the splash go.
  await act(async () => {});
}

beforeEach(() => {
  useSettingsStore.setState({
    lastSeenVersion: "0.0.1",
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWhatsNew", () => {
  it("says so on the first launch after an update", async () => {
    await launch();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0][0]).toBe(
      `Updated to Netherstone ${version}`,
    );
    expect(useSettingsStore.getState().lastSeenVersion).toBe(version);
  });

  it("says so once, not on every launch", async () => {
    await launch();
    cleanup();
    await launch();

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("says so after updating from a version that didn't track it", async () => {
    useSettingsStore.setState({ lastSeenVersion: null });
    await launch();

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("stays quiet on a fresh install", async () => {
    useSettingsStore.setState({
      lastSeenVersion: null,
      onboardingCompletedAt: null,
    });
    await launch();

    expect(toast).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().lastSeenVersion).toBe(version);
  });

  it("stays quiet in builds that can't update", async () => {
    vi.mocked(canUpdate).mockReturnValueOnce(false);
    await launch();

    expect(toast).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().lastSeenVersion).toBe("0.0.1");
  });

  it("opens this version's changelog in the browser panel", async () => {
    useUIStore.setState({ appMode: "data", isBrowserPanelOpen: false });
    await launch();

    const options = vi.mocked(toast).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    options.action.onClick();

    expect(useUIStore.getState()).toMatchObject({
      appMode: "notes",
      isBrowserPanelOpen: true,
      browserLastUrl: changelogUrl(version),
    });
    expect(changelogUrl("0.4.0")).toBe(
      "https://netherstone.app/changelog#v0.4.0",
    );
  });
});
