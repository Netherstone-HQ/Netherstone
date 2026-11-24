// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  onBack: null as (() => void) | null,
  exit: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  exit: app.exit,
  onBackButtonPress: (handler: () => void) => {
    app.onBack = handler;
    return Promise.resolve({ unregister: app.unregister });
  },
}));

import { followBrowserHistory, followSystemBack, usePhoneNav } from "./nav";

describe("Android's Back", () => {
  let stopHistory: () => void;
  let stopBack: () => void;

  beforeEach(() => {
    usePhoneNav.setState({ entries: [{ kind: "home" }] });
    stopHistory = followBrowserHistory();
    stopBack = followSystemBack();
  });

  afterEach(() => {
    stopBack();
    stopHistory();
    vi.restoreAllMocks();
    app.exit.mockClear();
  });

  it("closes the open shard", () => {
    const go = vi.spyOn(history, "go").mockImplementation(() => {});
    usePhoneNav.getState().push({ kind: "file" });

    app.onBack?.();

    expect(go).toHaveBeenCalledWith(-1);
    expect(app.exit).not.toHaveBeenCalled();
  });

  it("closes the app from home", () => {
    const go = vi.spyOn(history, "go").mockImplementation(() => {});

    app.onBack?.();

    expect(go).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalled();
  });

  it("goes back to the webview when the phone layout closes", async () => {
    stopBack();
    await vi.waitFor(() => expect(app.unregister).toHaveBeenCalled());
  });
});
