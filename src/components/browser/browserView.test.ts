// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  setBrowserWebviewBounds,
  setBrowserWebviewVisible,
} from "@/components/browser/browserCommands";
import { useCoversBrowser } from "@/components/browser/browserOcclusion";
import { BrowserViewController } from "@/components/browser/browserView";

vi.mock("@/components/browser/browserCommands", () => ({
  setBrowserWebviewBounds: vi.fn(async () => undefined),
  setBrowserWebviewVisible: vi.fn(async () => undefined),
}));

const setBounds = vi.mocked(setBrowserWebviewBounds);
const setVisible = vi.mocked(setBrowserWebviewVisible);

let resizeCallbacks: (() => void)[] = [];
let controller: BrowserViewController | null = null;

class ResizeObserverMock {
  constructor(private readonly callback: () => void) {}
  observe() {
    resizeCallbacks.push(this.callback);
  }
  disconnect() {
    resizeCallbacks = resizeCallbacks.filter((cb) => cb !== this.callback);
  }
  unobserve() {}
}

function setRect(
  element: Element,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  element.getBoundingClientRect = () => new DOMRect(left, top, width, height);
}

function resize() {
  for (const callback of resizeCallbacks) callback();
}

/** Lets MutationObserver callbacks and pending promises run. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function startController() {
  const viewport = document.createElement("div");
  document.getElementById("root")!.appendChild(viewport);
  setRect(viewport, 812.4, 90, 387.6, 610);
  controller = new BrowserViewController("browser", viewport);
  controller.start();
  return viewport;
}

function addOverlay(left: number, top: number, width: number, height: number) {
  const overlay = document.createElement("div");
  setRect(overlay, left, top, width, height);
  document.body.appendChild(overlay);
  return overlay;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Object.defineProperty(window, "devicePixelRatio", {
    value: 1.25,
    configurable: true,
  });
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  resizeCallbacks = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

it("places the view on device-pixel edges, once per change", () => {
  const viewport = startController();

  // 812.4px at 125% is 1015.5 device pixels; the right edge is 1500.
  expect(setBounds).toHaveBeenCalledTimes(1);
  expect(setBounds).toHaveBeenLastCalledWith(
    { x: 1016, y: 113, width: 484, height: 762 },
    1,
    "browser",
  );

  resize();
  expect(setBounds).toHaveBeenCalledTimes(1);

  setRect(viewport, 700.2, 90, 499.8, 610);
  resize();
  expect(setBounds).toHaveBeenCalledTimes(2);
  expect(setBounds).toHaveBeenLastCalledWith(
    { x: 875, y: 113, width: 625, height: 762 },
    2,
    "browser",
  );
});

it("pauses as soon as a dialog is added over it, and resumes when it closes", async () => {
  startController();

  const dialog = addOverlay(500, 200, 500, 300);
  await settle();
  expect(setVisible).toHaveBeenLastCalledWith(false, "browser");

  dialog.remove();
  await settle();
  expect(setVisible).toHaveBeenLastCalledWith(true, "browser");
  expect(setVisible).toHaveBeenCalledTimes(2);
});

it("pauses for a dialog that is still fading in from opacity 0", async () => {
  startController();

  const dialog = addOverlay(500, 200, 500, 300);
  dialog.style.opacity = "0";
  await settle();

  expect(setVisible).toHaveBeenLastCalledWith(false, "browser");
});

it("finds fixed content inside a zero-sized portal wrapper", async () => {
  startController();

  const wrapper = addOverlay(0, 0, 0, 0);
  const menu = document.createElement("div");
  setRect(menu, 900, 120, 200, 240);
  wrapper.appendChild(menu);
  await settle();

  expect(setVisible).toHaveBeenLastCalledWith(false, "browser");
});

it("stays live for overlays elsewhere or hidden ones", async () => {
  startController();

  addOverlay(100, 100, 300, 300);
  const hidden = addOverlay(900, 100, 200, 200);
  hidden.style.visibility = "hidden";
  await settle();

  expect(setVisible).not.toHaveBeenCalled();
});

it("pauses while an in-layout overlay such as Settings is open", async () => {
  startController();

  const settings = renderHook(() => useCoversBrowser());
  await settle();
  expect(setVisible).toHaveBeenLastCalledWith(false, "browser");

  settings.unmount();
  await settle();
  expect(setVisible).toHaveBeenLastCalledWith(true, "browser");
});

it("hides off screen, and moves to the latest box before showing again", async () => {
  const viewport = startController();

  // Another mode hides the panel: it has no size.
  setRect(viewport, 0, 0, 0, 0);
  resize();
  await settle();
  expect(setVisible).toHaveBeenLastCalledWith(false, "browser");
  expect(setBounds).toHaveBeenCalledTimes(1);

  setRect(viewport, 600, 90, 600, 610);
  resize();
  await settle();

  expect(setBounds).toHaveBeenLastCalledWith(
    { x: 750, y: 113, width: 750, height: 762 },
    2,
    "browser",
  );
  expect(setVisible).toHaveBeenLastCalledWith(true, "browser");
  expect(setBounds.mock.invocationCallOrder[1]).toBeLessThan(
    setVisible.mock.invocationCallOrder[1],
  );
});

it("doesn't move the view while paused", async () => {
  const viewport = startController();

  addOverlay(500, 200, 500, 300);
  await settle();
  setRect(viewport, 600, 90, 600, 610);
  resize();

  expect(setBounds).toHaveBeenCalledTimes(1);
});
