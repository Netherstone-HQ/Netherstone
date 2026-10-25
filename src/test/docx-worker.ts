import { vi } from "vitest";

import type { FromWorker, ToWorker, WorkerScope } from "@/lib/import/formats/docx/protocol";
import { serve } from "@/lib/import/formats/docx/serve";

/**
 * Tests have no workers, so the Word import's worker runs on this thread.
 * Messages still arrive on a later task and must survive being copied
 * between threads; they are handed over as they are, since a copy would be
 * made in another realm than the jsdom tests'.
 */
export class DocxWorker {
  /** Every worker started and not yet stopped. */
  static running = new Set<DocxWorker>();

  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly scope: WorkerScope;

  constructor(url: URL | string) {
    if (!String(url).includes("docx.worker")) throw new Error(`No test worker for ${url}`);
    this.scope = {
      onmessage: null,
      postMessage: (message) => this.deliver(message, (data) => this.onmessage?.({ data } as MessageEvent<FromWorker>)),
    };
    serve(this.scope);
    DocxWorker.running.add(this);
  }

  postMessage(message: ToWorker) {
    this.deliver(message, (data) => this.scope.onmessage?.({ data } as MessageEvent<ToWorker>));
  }

  terminate() {
    DocxWorker.running.delete(this);
  }

  private deliver<T>(message: T, receive: (data: T) => void) {
    structuredClone(message);
    setTimeout(() => {
      if (DocxWorker.running.has(this)) receive(message);
    });
  }
}

export function useDocxWorker() {
  vi.stubGlobal("Worker", DocxWorker);
}
