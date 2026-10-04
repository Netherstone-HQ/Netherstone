// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cancelIdle, requestIdle } from "./idle-callback";

// The fallback is what WebKit webviews (Linux, macOS) run.
const { requestIdleCallback, cancelIdleCallback } = window;

/** Paints a frame, then runs the timeout the fallback queued from it. */
function paintFrame() {
  vi.advanceTimersToNextFrame();
  // Fake timers run a 0 ms timeout queued during a tick 1 ms later.
  vi.advanceTimersByTime(1);
}

beforeEach(() => {
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.requestIdleCallback = requestIdleCallback;
  window.cancelIdleCallback = cancelIdleCallback;
});

it("runs after the next frame is painted, not on the next timer tick", () => {
  const callback = vi.fn();
  requestIdle(callback);

  vi.advanceTimersByTime(5);
  expect(callback).not.toHaveBeenCalled();

  paintFrame();
  expect(callback).toHaveBeenCalledOnce();
  expect(callback.mock.calls[0][0].didTimeout).toBe(false);
});

it("reports what's left of the frame it runs after", () => {
  let frameStart = 0;
  requestAnimationFrame((time) => {
    frameStart = time;
  });
  let deadline: IdleDeadline | undefined;
  requestIdle((idleDeadline) => {
    deadline = idleDeadline;
  });

  paintFrame();
  const elapsed = performance.now() - frameStart;
  expect(deadline!.timeRemaining()).toBe(16 - elapsed);

  vi.advanceTimersByTime(10);
  expect(deadline!.timeRemaining()).toBe(6 - elapsed);

  vi.advanceTimersByTime(10);
  expect(deadline!.timeRemaining()).toBe(0);
});

it("runs on its timeout when no frame comes, and only once", () => {
  // A hidden window paints no frames.
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
    frames.push(frame);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  const callback = vi.fn();
  requestIdle(callback, { timeout: 1000 });

  vi.advanceTimersByTime(999);
  expect(callback).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(callback).toHaveBeenCalledOnce();
  expect(callback.mock.calls[0][0].didTimeout).toBe(true);

  // A frame arriving late doesn't run it again.
  frames[0](performance.now());
  vi.runAllTimers();
  expect(callback).toHaveBeenCalledOnce();
});

it("cancels before the frame and between the frame and the callback", () => {
  const beforeFrame = vi.fn();
  cancelIdle(requestIdle(beforeFrame, { timeout: 1000 }));

  const afterFrame = vi.fn();
  const id = requestIdle(afterFrame, { timeout: 1000 });
  vi.advanceTimersToNextFrame(); // The frame queued the callback's timeout.
  cancelIdle(id);

  vi.runAllTimers();
  expect(beforeFrame).not.toHaveBeenCalled();
  expect(afterFrame).not.toHaveBeenCalled();
});

it("uses requestIdleCallback where the browser has it", () => {
  const native = vi.fn(() => 42);
  const cancelNative = vi.fn();
  window.requestIdleCallback = native;
  window.cancelIdleCallback = cancelNative;

  const callback = vi.fn();
  const id = requestIdle(callback, { timeout: 1000 });
  cancelIdle(id);

  expect(native).toHaveBeenCalledWith(callback, { timeout: 1000 });
  expect(cancelNative).toHaveBeenCalledWith(42);
});
