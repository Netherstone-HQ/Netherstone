// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "@/store";
import { useSettingsStore } from "@/store/settings";
import { useWelcomeTour } from "./useWelcomeTour";

vi.mock("@/hooks/useAutosave", () => ({ flushPendingAutosave: vi.fn(async () => {}) }));

const FINISHED = "2026-10-01T09:00:00.000Z";

beforeEach(() => {
  useSettingsStore.setState({ onboardingCompletedAt: FINISHED });
  useUIStore.setState({ activeNavItem: "settings" });
});

describe("useWelcomeTour", () => {
  it("shows the tour on a first run, with no way to close it", () => {
    useSettingsStore.setState({ onboardingCompletedAt: null });
    const { result } = renderHook(() => useWelcomeTour());
    expect(result.current.screen).toBe("onboarding");
    expect(result.current.close).toBeUndefined();
  });

  it("shows the tour as soon as Settings asks for it again, and closes Settings", async () => {
    const { result } = renderHook(() => useWelcomeTour());
    expect(result.current.screen).toBe("app");

    act(() => useSettingsStore.getState().resetOnboarding());

    await waitFor(() => expect(result.current.screen).toBe("onboarding"));
    expect(useUIStore.getState().activeNavItem).toBeNull();
    expect(result.current.close).toBeDefined();
  });

  it("puts the previous finish time back when the replayed tour is closed", async () => {
    const { result } = renderHook(() => useWelcomeTour());
    act(() => useSettingsStore.getState().resetOnboarding());
    await waitFor(() => expect(result.current.screen).toBe("onboarding"));

    act(() => result.current.close?.());

    expect(useSettingsStore.getState().onboardingCompletedAt).toBe(FINISHED);
    expect(result.current.screen).toBe("app-after-onboarding");
  });
});
