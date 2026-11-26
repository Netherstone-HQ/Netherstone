// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettings } from "./AppearanceSettings";

const platform = vi.hoisted(() => ({ IS_MOBILE: false }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_MOBILE() {
    return platform.IS_MOBILE;
  },
}));

describe("AppearanceSettings", () => {
  afterEach(() => {
    cleanup();
    platform.IS_MOBILE = false;
  });

  it("offers zoom on desktop", () => {
    render(<AppearanceSettings />);
    expect(screen.queryAllByText("Zoom").length).toBeGreaterThan(0);
  });

  it("leaves zoom out on phones, where the webview can't zoom", () => {
    platform.IS_MOBILE = true;
    render(<AppearanceSettings />);
    expect(screen.queryAllByText("Zoom")).toHaveLength(0);
  });
});
