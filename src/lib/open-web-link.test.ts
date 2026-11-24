import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ IS_MOBILE: false }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get IS_MOBILE() {
    return platform.IS_MOBILE;
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { useUIStore } from "@/store/ui";
import { openWebLink } from "./open-web-link";

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

  it("opens a page in the system's browser on a phone", async () => {
    platform.IS_MOBILE = true;
    await openWebLink(PAGE, "browser-panel");
    expect(opener.openUrl).toHaveBeenCalledWith(PAGE);
  });
});
