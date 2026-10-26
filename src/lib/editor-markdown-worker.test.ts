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
  const first = serializeMarkdownInWorker([]);
  const [worker] = FakeWorker.instances;

  vi.advanceTimersByTime(60_000);
  expect(worker.terminated).toBe(false);

  worker.reply("# Saved");
  await expect(first).resolves.toBe("# Saved");
  vi.advanceTimersByTime(30_000);
  expect(worker.terminated).toBe(true);

  const second = serializeMarkdownInWorker([]);
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].reply("# Again");
  await expect(second).resolves.toBe("# Again");
});

it("answers every read of the same shard", async () => {
  const { deserializeMarkdownInWorker } =
    await import("./editor-markdown-worker");
  const mine = deserializeMarkdownInWorker("# Mine", { filePath: "a.md" });
  const theirs = deserializeMarkdownInWorker("# Theirs", { filePath: "a.md" });
  const [worker] = FakeWorker.instances;

  for (const plateValue of [["mine"], ["theirs"]]) {
    const { requestId, filePath } = worker.posted.shift()!;
    worker.onmessage?.({
      data: { type: "success", requestId, filePath, plateValue },
    } as MessageEvent);
  }

  await expect(mine).resolves.toEqual(["mine"]);
  await expect(theirs).resolves.toEqual(["theirs"]);
});

it("passes a worker error on without redoing the work", async () => {
  const { deserializeMarkdownInWorker } =
    await import("./editor-markdown-worker");
  const fallback = vi.fn(() => []);
  const read = deserializeMarkdownInWorker("# Big", { fallback });
  const [worker] = FakeWorker.instances;
  const { requestId, filePath } = worker.posted.shift()!;

  worker.onmessage?.({
    data: { type: "error", requestId, filePath, error: "Bad shard" },
  } as MessageEvent);

  await expect(read).rejects.toThrow("Bad shard");
  expect(fallback).not.toHaveBeenCalled();
});

it("puts an urgent save before a running read, then reads again", async () => {
  const { deserializeMarkdownInWorker, serializeMarkdownInWorker } =
    await import("./editor-markdown-worker");
  const read = deserializeMarkdownInWorker("# Big", { filePath: "big.md" });
  const save = serializeMarkdownInWorker([], {
    filePath: "open.md",
    urgent: true,
  });
  const [first] = FakeWorker.instances;

  expect(first.terminated).toBe(true);
  const next = FakeWorker.instances[1];
  expect(next.posted.map((message) => message.filePath)).toEqual([
    "open.md",
    "big.md",
  ]);

  next.reply("# Saved");
  await expect(save).resolves.toBe("# Saved");

  const { requestId, filePath } = next.posted.shift()!;
  next.onmessage?.({
    data: { type: "success", requestId, filePath, plateValue: ["big"] },
  } as MessageEvent);
  await expect(read).resolves.toEqual(["big"]);
});

it("queues an autosave behind a running read", async () => {
  const { deserializeMarkdownInWorker, serializeMarkdownInWorker } =
    await import("./editor-markdown-worker");
  void deserializeMarkdownInWorker("# Big", { filePath: "big.md" });
  void serializeMarkdownInWorker([], { filePath: "open.md" });
  const [worker] = FakeWorker.instances;

  expect(worker.terminated).toBe(false);
  expect(FakeWorker.instances).toHaveLength(1);
  expect(worker.posted.map((message) => message.filePath)).toEqual([
    "big.md",
    "open.md",
  ]);
});
