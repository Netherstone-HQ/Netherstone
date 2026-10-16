// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function showSplash(className?: string) {
  document.body.innerHTML = `<div id="splash" data-start="0"></div>`;
  const splash = document.getElementById("splash")!;
  if (className) splash.classList.add(className);
  vi.resetModules();
  const { dismissSplash } = await import("./splash");
  return { splash, dismissSplash };
}

describe("dismissSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockReturnValue(400);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("lets the first launch's motion play out", async () => {
    const { splash, dismissSplash } = await showSplash();
    dismissSplash();

    vi.advanceTimersByTime(699);
    expect(splash.classList.contains("is-leaving")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(splash.classList.contains("is-leaving")).toBe(true);
  });

  it("lifts a still splash as soon as the app is ready", async () => {
    const { splash, dismissSplash } = await showSplash("is-still");
    dismissSplash();

    vi.advanceTimersByTime(0);
    expect(splash.classList.contains("is-leaving")).toBe(true);
    vi.advanceTimersByTime(200);
    expect(document.getElementById("splash")).toBeNull();
  });
});
