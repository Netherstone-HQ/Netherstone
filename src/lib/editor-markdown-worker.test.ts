// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posted: { requestId: number; filePath: string | null }[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { requestId: number; filePath: string | null }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(markdown: string) {
    const { requestId, filePath } = this.posted.shift()!;
    this.onmessage?.({
      data: { type: "success", requestId, filePath, markdown },
    } as MessageEvent);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shuts the worker down once it has been idle", async () => {
  const { preloadEditorMarkdownWorker } =
    await import("./editor-markdown-worker");
  preloadEditorMarkdownWorker();
  const [worker] = FakeWorker.instances;

  vi.advanceTimersByTime(29_000);
  expect(worker.terminated).toBe(false);
  vi.advanceTimersByTime(1_000);
  expect(worker.terminated).toBe(true);
});

it("stays up while a request is in flight and restarts on demand", async () => {
  const { serializeMarkdownInWorker } =
    await import("./editor-markdown-worker");
  const first = serializeMarkdownInWorker([], { timeoutMs: 0 });
  const [worker] = FakeWorker.instances;

  vi.advanceTimersByTime(60_000);
  expect(worker.terminated).toBe(false);

  worker.reply("# Saved");
  await expect(first).resolves.toBe("# Saved");
  vi.advanceTimersByTime(30_000);
  expect(worker.terminated).toBe(true);

  const second = serializeMarkdownInWorker([], { timeoutMs: 0 });
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].reply("# Again");
  await expect(second).resolves.toBe("# Again");
});
