type SerializeMarkdownWorkerRequest = {
  type: "serialize";
  requestId: number;
  filePath: string | null;
  children: unknown;
};

type DeserializeMarkdownWorkerRequest = {
  type: "deserialize";
  requestId: number;
  filePath: string | null;
  markdown: string;
};

type MarkdownWorkerRequest =
  | SerializeMarkdownWorkerRequest
  | DeserializeMarkdownWorkerRequest;

type SerializeMarkdownWorkerSuccess = {
  type: "success";
  requestId: number;
  filePath: string | null;
  markdown: string;
};

type DeserializeMarkdownWorkerSuccess = {
  type: "success";
  requestId: number;
  filePath: string | null;
  plateValue: unknown[];
};

type MarkdownWorkerError = {
  type: "error";
  requestId: number;
  filePath: string | null;
  error: string;
};

type PendingRequest = {
  payload: MarkdownWorkerRequest;
  /** Set for saves: a newer save with the same key supersedes this one. */
  requestKey: string | null;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export interface SerializeMarkdownInWorkerOptions {
  /** Does the work where Web Workers aren't available (tests). */
  fallback?: () => string | Promise<string>;
  /**
   * Someone is waiting on this save (closing, switching shards, renaming):
   * it stops a running read and goes first, and the read starts again after.
   */
  urgent?: boolean;
  /**
   * Logical file identity for race handling and worker metadata.
   * Requests for the same file supersede older in-flight requests.
   */
  filePath?: string | null;
  /**
   * Optional override for request deduping/race handling.
   * Defaults to the normalized file path when present.
   */
  requestKey?: string;
}

export interface DeserializeMarkdownInWorkerOptions {
  /** Does the work where Web Workers aren't available (tests). */
  fallback?: () => unknown[] | Promise<unknown[]>;
  /**
   * Logical file identity for worker metadata and logging.
   */
  filePath?: string | null;
}

const DEFAULT_REQUEST_KEY = "__default__";
/**
 * The worker holds its own copy of the editor's markdown stack, tens of MB,
 * so it shuts down once nothing has used it for this long. Editing keeps it
 * alive: autosave serializes every few seconds.
 */
const WORKER_IDLE_SHUTDOWN_MS = 30_000;

let workerInstance: Worker | null = null;
let idleShutdownTimer: number | null = null;
let nextRequestId = 1;

const pendingRequests = new Map<number, PendingRequest>();

class SupersededSerializationError extends Error {
  constructor(
    message = "Serialization request was superseded by a newer request.",
  ) {
    super(message);
    this.name = "SupersededSerializationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSerializeSuccessMessage(
  value: unknown,
): value is SerializeMarkdownWorkerSuccess {
  return (
    isObject(value) &&
    value.type === "success" &&
    typeof value.requestId === "number" &&
    typeof value.markdown === "string" &&
    (value.filePath === null || typeof value.filePath === "string")
  );
}

function isDeserializeSuccessMessage(
  value: unknown,
): value is DeserializeMarkdownWorkerSuccess {
  return (
    isObject(value) &&
    value.type === "success" &&
    typeof value.requestId === "number" &&
    Array.isArray(value.plateValue) &&
    (value.filePath === null || typeof value.filePath === "string")
  );
}

function isErrorMessage(value: unknown): value is MarkdownWorkerError {
  return (
    isObject(value) &&
    value.type === "error" &&
    typeof value.requestId === "number" &&
    typeof value.error === "string" &&
    (value.filePath === null || typeof value.filePath === "string")
  );
}

function normalizeFilePath(filePath?: string | null): string | null {
  if (typeof filePath !== "string") return null;

  const trimmed = filePath.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\\/g, "/");
}

function resolveRequestKey(
  requestKey?: string,
  filePath?: string | null,
): string {
  const normalizedRequestKey =
    typeof requestKey === "string" ? requestKey.trim() : "";
  if (normalizedRequestKey) return normalizedRequestKey;

  return normalizeFilePath(filePath) ?? DEFAULT_REQUEST_KEY;
}

/** Takes a request off the pending list, returning it if it was there. */
function takeRequest(requestId: number): PendingRequest | undefined {
  const pending = pendingRequests.get(requestId);
  if (!pending) return undefined;

  pendingRequests.delete(requestId);
  if (pendingRequests.size === 0) scheduleIdleShutdown();
  return pending;
}

function rejectRequest(requestId: number, error: Error) {
  takeRequest(requestId)?.reject(error);
}

function resolveRequest(requestId: number, value: unknown) {
  takeRequest(requestId)?.resolve(value);
}

function rejectAllPendingRequests(error: Error) {
  const requestIds = [...pendingRequests.keys()];

  for (const requestId of requestIds) {
    rejectRequest(requestId, error);
  }
}

function rejectSupersededRequestsForKey(
  requestKey: string,
  nextRequestIdForKey: number,
) {
  for (const [requestId, pending] of pendingRequests.entries()) {
    if (pending.requestKey !== requestKey) continue;
    if (requestId === nextRequestIdForKey) continue;

    rejectRequest(requestId, new SupersededSerializationError());
  }
}

function cancelIdleShutdown() {
  if (idleShutdownTimer === null) return;
  window.clearTimeout(idleShutdownTimer);
  idleShutdownTimer = null;
}

function scheduleIdleShutdown() {
  if (!workerInstance) return;
  cancelIdleShutdown();
  idleShutdownTimer = window.setTimeout(() => {
    idleShutdownTimer = null;
    if (pendingRequests.size === 0) resetWorkerInstance();
  }, WORKER_IDLE_SHUTDOWN_MS);
}

function resetWorkerInstance() {
  cancelIdleShutdown();
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

function handleWorkerMessage(event: MessageEvent<unknown>) {
  const data = event.data;

  // A request superseded by a newer one is no longer pending, so its reply
  // is dropped.
  if (isSerializeSuccessMessage(data)) {
    resolveRequest(data.requestId, data.markdown);
    return;
  }

  if (isDeserializeSuccessMessage(data)) {
    resolveRequest(data.requestId, data.plateValue);
    return;
  }

  if (isErrorMessage(data)) {
    rejectRequest(data.requestId, new Error(data.error));
    return;
  }

  rejectAllPendingRequests(
    new Error("Editor markdown worker returned an unexpected response."),
  );
  resetWorkerInstance();
}

function handleWorkerFailure(error: Error) {
  rejectAllPendingRequests(error);
  resetWorkerInstance();
}

function getWorker(): Worker {
  cancelIdleShutdown();
  if (workerInstance) {
    return workerInstance;
  }

  const worker = new Worker(
    new URL("../components/editor/serialize.worker.ts", import.meta.url),
    { type: "module" },
  );

  worker.onmessage = handleWorkerMessage;
  worker.onerror = (event) => {
    handleWorkerFailure(
      new Error(event.message || "Editor markdown worker crashed."),
    );
  };
  worker.onmessageerror = () => {
    handleWorkerFailure(
      new Error("Editor markdown worker could not deserialize a message."),
    );
  };

  workerInstance = worker;
  return workerInstance;
}

/**
 * Starts a fresh worker with the pending saves first and the reads after.
 * The old worker is stopped, so a save never waits behind a long read, and
 * the reads it was running start again from the beginning.
 */
function restartWithSavesFirst() {
  resetWorkerInstance();
  const pending = [...pendingRequests.values()].map((request) => request.payload);
  const worker = getWorker();

  for (const payload of [
    ...pending.filter((request) => request.type === "serialize"),
    ...pending.filter((request) => request.type === "deserialize"),
  ]) {
    worker.postMessage(payload);
  }
}

/** Posts a request to the worker and waits for its reply. */
function requestFromWorker(
  payload: MarkdownWorkerRequest,
  requestKey: string | null,
  urgent = false,
): Promise<unknown> {
  const worker = getWorker();
  const readIsRunning =
    urgent &&
    [...pendingRequests.values()].some(
      (request) => request.payload.type === "deserialize",
    );

  return new Promise((resolve, reject) => {
    pendingRequests.set(payload.requestId, {
      payload,
      requestKey,
      resolve,
      reject,
    });
    if (requestKey !== null) {
      rejectSupersededRequestsForKey(requestKey, payload.requestId);
    }

    try {
      if (readIsRunning) {
        restartWithSavesFirst();
      } else {
        worker.postMessage(payload);
      }
    } catch (error) {
      rejectRequest(
        payload.requestId,
        error instanceof Error
          ? error
          : new Error("Failed to post worker message."),
      );
    }
  });
}

function runWithoutWorker<T>(fallback: (() => T | Promise<T>) | undefined) {
  if (!fallback) {
    throw new Error("Web Workers are not available in this environment.");
  }

  return fallback();
}

export async function deserializeMarkdownInWorker(
  markdown: string,
  options: DeserializeMarkdownInWorkerOptions = {},
): Promise<unknown[]> {
  if (typeof Worker === "undefined") return runWithoutWorker(options.fallback);

  const value = await requestFromWorker(
    {
      type: "deserialize",
      requestId: nextRequestId++,
      filePath: normalizeFilePath(options.filePath),
      markdown,
    },
    // Every read gets its own result, even of the same shard.
    null,
  );

  return Array.isArray(value) ? value : [];
}

export function preloadEditorMarkdownWorker() {
  if (typeof Worker === "undefined") return;

  try {
    getWorker();
    scheduleIdleShutdown();
  } catch {
    // Ignore preload failures. The first request starts the worker again.
  }
}

export async function serializeMarkdownInWorker(
  children: unknown,
  options: SerializeMarkdownInWorkerOptions = {},
): Promise<string> {
  if (typeof Worker === "undefined") return runWithoutWorker(options.fallback);

  const filePath = normalizeFilePath(options.filePath);
  const markdown = await requestFromWorker(
    {
      type: "serialize",
      requestId: nextRequestId++,
      filePath,
      children,
    },
    resolveRequestKey(options.requestKey, filePath),
    options.urgent,
  );

  return typeof markdown === "string" ? markdown : "";
}

export function terminateEditorMarkdownWorker() {
  rejectAllPendingRequests(
    new Error("Editor markdown worker was terminated before completion."),
  );
  resetWorkerInstance();
}
