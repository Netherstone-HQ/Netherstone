// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBrowserWebview } from "@/components/browser/useBrowserWebview";

type Handler = () => void;

const created: { label: string; url: string; fireCreated: () => void }[] = [];

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  Webview: class {
    static getByLabel = vi.fn(async () => null);
    private handlers: Record<string, Handler[]> = {};

    constructor(_window: unknown, label: string, options: { url: string }) {
      created.push({
        label,
        url: options.url,
        fireCreated: () => this.handlers["tauri://created"]?.forEach((h) => h()),
      });
    }

    async once(event: string, handler: Handler) {
      (this.handlers[event] ??= []).push(handler);
      return () => undefined;
    }

    async close() {}
  },
}));

vi.mock("@/components/browser/browserCommands", () => ({
  DEFAULT_BROWSER_WEBVIEW_LABEL: "browser",
  resetBrowserWebviewState: vi.fn(async () => undefined),
}));

vi.mock("@/components/browser/browserView", () => ({
  BrowserViewController: class {
    start() {}
    dispose() {}
  },
}));

beforeEach(() => {
  created.length = 0;
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

it("becomes ready when the URL is saved before the webview finishes creating", async () => {
  const { result, rerender } = renderHook(
    ({ initialUrl }) => useBrowserWebview({ isOpen: true, initialUrl }),
    { initialProps: { initialUrl: "https://netherstone.app" } },
  );

  act(() => result.current.setViewportElement(document.createElement("div")));
  await waitFor(() => expect(created).toHaveLength(1));
  expect(result.current.status).toBe("creating");

  // The first page starts loading and the panel saves its URL, which feeds
  // back into initialUrl while creation is still in flight.
  rerender({ initialUrl: "https://www.netherstone.app/" });

  act(() => created[0].fireCreated());

  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(created).toHaveLength(1);
  expect(created[0].url).toBe("https://netherstone.app");
});
