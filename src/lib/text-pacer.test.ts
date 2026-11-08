// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TextPacer } from "./text-pacer";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

function paced() {
  let shown = "";
  const pacer = new TextPacer((text) => (shown += text));
  return { pacer, shown: () => shown };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
});
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("TextPacer", () => {
  it("starts on the next frame and shows a big block over time, not at once", async () => {
    const { pacer, shown } = paced();
    const block = "a".repeat(2000);
    pacer.push(block);
    expect(shown()).toBe("");

    await vi.advanceTimersToNextFrame();
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().length).toBeLessThan(block.length / 10);

    // Still going after half a second, so no late block either.
    await vi.advanceTimersByTimeAsync(500);
    expect(shown().length).toBeLessThan(block.length);

    // And never far behind: a backlog this big is caught up in seconds.
    await vi.advanceTimersByTimeAsync(3000);
    expect(shown()).toBe(block);
  });

  it("shows text that comes slowly about as it comes", async () => {
    const { pacer, shown } = paced();
    for (let i = 0; i < 20; i++) {
      pacer.push("word ");
      await vi.advanceTimersByTimeAsync(100);
      expect(shown()).toBe("word ".repeat(i + 1));
    }
  });

  it("never splits a character made of two code units", async () => {
    const shown: string[] = [];
    const pacer = new TextPacer((text) => shown.push(text));
    pacer.push("🙂".repeat(500));
    await vi.advanceTimersByTimeAsync(5000);
    expect(shown.join("")).toBe("🙂".repeat(500));
    for (const piece of shown) expect([...piece].every((char) => char === "🙂")).toBe(true);
  });

  it("shows everything at once on flush, and says when all is shown", async () => {
    const { pacer, shown } = paced();
    let done = false;
    pacer.push("x".repeat(1000));
    void pacer.whenShown().then(() => (done = true));
    await vi.advanceTimersToNextFrame();
    expect(done).toBe(false);

    pacer.flush();
    await Promise.resolve();
    expect(shown()).toBe("x".repeat(1000));
    expect(done).toBe(true);
  });

  it("resolves once paced text is all shown", async () => {
    const { pacer, shown } = paced();
    pacer.push("y".repeat(300));
    const shownAll = pacer.whenShown().then(() => shown());
    await vi.advanceTimersByTimeAsync(3000);
    await expect(shownAll).resolves.toBe("y".repeat(300));
  });

  it("shows at once in a hidden window, which gets no frames", async () => {
    const { pacer, shown } = paced();
    pacer.push("z".repeat(500));
    await vi.advanceTimersToNextFrame();
    setHidden(true);
    expect(shown()).toBe("z".repeat(500));

    pacer.push("more");
    expect(shown()).toBe(`${"z".repeat(500)}more`);
  });
});
