import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ IS_MOBILE: false, IS_ANDROID: false }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get IS_MOBILE() {
    return platform.IS_MOBILE;
  },
  get IS_ANDROID() {
    return platform.IS_ANDROID;
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => opener);
const events = vi.hoisted(
  () => new Map<string, (event: { payload: string }) => void>(),
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: (event: { payload: string }) => void) => {
    events.set(name, handler);
    return Promise.resolve(() => events.delete(name));
  },
}));

import { useUIStore } from "@/store/ui";
import { openPagesOutside, openWebLink } from "./open-web-link";

const PAGE = "https://example.com/page";

describe("openWebLink", () => {
  beforeEach(() => {
    opener.openUrl.mockClear();
  });

  it("opens a page in the browser panel when Settings says so", async () => {
    platform.IS_MOBILE = false;
    const openInBrowserPanel = vi
      .spyOn(useUIStore.getState(), "openInBrowserPanel")
      .mockImplementation(() => {});
    await openWebLink(PAGE, "browser-panel");
    expect(openInBrowserPanel).toHaveBeenCalledWith(PAGE);
    expect(opener.openUrl).not.toHaveBeenCalled();
  });

  it("opens a page in the system's browser on an iPhone", async () => {
    platform.IS_MOBILE = true;
    await openWebLink(PAGE, "browser-panel");
    expect(opener.openUrl).toHaveBeenCalledWith(PAGE);
  });

  it("opens a page over the app on Android, or in the browser when Settings says so", async () => {
    platform.IS_MOBILE = true;
    platform.IS_ANDROID = true;
    const postMessage = vi.fn();
    vi.stubGlobal("window", {
      NetherstoneAndroid: { postMessage, addEventListener: vi.fn() },
    });
    try {
      await openWebLink(PAGE, "browser-panel");
      expect(postMessage).toHaveBeenCalledWith(
        JSON.stringify({ method: "openInApp", args: [PAGE] }),
      );
      expect(opener.openUrl).not.toHaveBeenCalled();

      await openWebLink(PAGE, "your-browser");
      await openWebLink("mailto:someone@example.com", "browser-panel");
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(opener.openUrl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      platform.IS_ANDROID = false;
    }
  });
});

describe("openPagesOutside", () => {
  beforeEach(() => {
    opener.openUrl.mockClear();
  });

  it("opens web pages that didn't load in the app's view, and nothing else", () => {
    platform.IS_MOBILE = true;
    const stop = openPagesOutside();
    const refused = events.get("phone-navigation:open-outside");
    refused?.({ payload: PAGE });
    refused?.({ payload: "http://asset.localhost/picture.png" });
    stop();
    expect(opener.openUrl).toHaveBeenCalledTimes(1);
    expect(opener.openUrl).toHaveBeenCalledWith(PAGE);
  });
});
