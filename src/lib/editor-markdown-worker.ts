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

type MarkdownWorkerSuccess =
  | SerializeMarkdownWorkerSuccess
  | DeserializeMarkdownWorkerSuccess;

type MarkdownWorkerError = {
  type: "error";
  requestId: number;
  filePath: string | null;
  error: string;
};

type LegacySerializeMarkdownWorkerSuccess = {
  markdown: string;
  filePath?: string | null;
};

type PendingRequest = {
  requestId: number;
  requestKey: string;
  filePath: string | null;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

export interface SerializeMarkdownInWorkerOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fallback?: () => string | Promise<string>;
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
  timeoutMs?: number;
  signal?: AbortSignal;
  fallback?: () => unknown[] | Promise<unknown[]>;
  /**
   * Logical file identity for worker metadata and logging.
   */
  filePath?: string | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_KEY = "__default__";

let workerInstance: Worker | null = null;
let nextRequestId = 1;
let lastLegacyRequestId: number | null = null;

const pendingRequests = new Map<number, PendingRequest>();
const latestRequestIdByKey = new Map<string, number>();

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

function isLegacySuccessMessage(
  value: unknown,
): value is LegacySerializeMarkdownWorkerSuccess {
  return (
    isObject(value) &&
    typeof value.markdown === "string" &&
    (!("filePath" in value) ||
      value.filePath === null ||
      typeof value.filePath === "string")
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isSupersededError(error: unknown): boolean {
  return error instanceof SupersededSerializationError;
}

function shouldBypassFallback(error: unknown): boolean {
  return isAbortError(error) || isSupersededError(error);
}

function cleanupRequest(requestId: number) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  pendingRequests.delete(requestId);

  if (latestRequestIdByKey.get(pending.requestKey) === requestId) {
    latestRequestIdByKey.delete(pending.requestKey);
  }

  if (lastLegacyRequestId === requestId) {
    lastLegacyRequestId = null;
  }
}

function rejectRequest(requestId: number, error: Error) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  pending.cleanup();
  pending.reject(error);
}

function resolveRequest(requestId: number, value: unknown) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  pending.cleanup();
  pending.resolve(value);
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

function resetWorkerInstance() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }

  lastLegacyRequestId = null;
  latestRequestIdByKey.clear();
}

function handleWorkerMessage(event: MessageEvent<unknown>) {
  const data = event.data;

  if (isSerializeSuccessMessage(data) || isDeserializeSuccessMessage(data)) {
    const pending = pendingRequests.get(data.requestId);

    if (!pending) {
      return;
    }

    const latestRequestIdForKey = latestRequestIdByKey.get(pending.requestKey);
    if (
      latestRequestIdForKey !== undefined &&
      latestRequestIdForKey !== data.requestId
    ) {
      rejectRequest(data.requestId, new SupersededSerializationError());
      return;
    }

    if (isSerializeSuccessMessage(data)) {
      resolveRequest(data.requestId, data.markdown);
      return;
    }

    resolveRequest(data.requestId, data.plateValue);
    return;
  }

  if (isErrorMessage(data)) {
    const pending = pendingRequests.get(data.requestId);

    if (!pending) {
      return;
    }

    const latestRequestIdForKey = latestRequestIdByKey.get(pending.requestKey);
    if (
      latestRequestIdForKey !== undefined &&
      latestRequestIdForKey !== data.requestId
    ) {
      rejectRequest(data.requestId, new SupersededSerializationError());
      return;
    }

    rejectRequest(data.requestId, new Error(data.error));
    return;
  }

  if (isLegacySuccessMessage(data) && lastLegacyRequestId !== null) {
    resolveRequest(lastLegacyRequestId, data.markdown);
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

async function runFallbackValue<T>(
  fallback: (() => T | Promise<T>) | undefined,
  originalError: unknown,
): Promise<T> {
  if (shouldBypassFallback(originalError)) {
    throw originalError;
  }

  if (!fallback) {
    throw originalError instanceof Error
      ? originalError
      : new Error(String(originalError));
  }

  return await fallback();
}

async function runFallback(
  fallback: SerializeMarkdownInWorkerOptions["fallback"],
  originalError: unknown,
): Promise<string> {
  return runFallbackValue<string>(fallback, originalError);
}

export async function deserializeMarkdownInWorker(
  markdown: string,
  options: DeserializeMarkdownInWorkerOptions = {},
): Promise<unknown[]> {
  if (typeof Worker === "undefined") {
    return runFallbackValue(
      options.fallback,
      new Error("Web Workers are not available in this environment."),
    );
  }

  const filePath = normalizeFilePath(options.filePath);
  const requestKey = filePath ? `deserialize:${filePath}` : "__deserialize__";

  try {
    const worker = getWorker();
    const requestId = nextRequestId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return await new Promise<unknown[]>((resolve, reject) => {
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const timeoutId =
        timeoutMs > 0
          ? window.setTimeout(() => {
              finish(() => {
                cleanupRequest(requestId);
                reject(
                  new Error(
                    `Markdown deserialization worker timed out after ${timeoutMs}ms.`,
                  ),
                );
              });
            }, timeoutMs)
          : null;

      const abortHandler = () => {
        finish(() => {
          cleanupRequest(requestId);
          reject(new DOMException("Deserialization aborted.", "AbortError"));
        });
      };

      const cleanup = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }

        if (options.signal) {
          options.signal.removeEventListener("abort", abortHandler);
        }

        cleanupRequest(requestId);
      };

      if (options.signal?.aborted) {
        cleanup();
        reject(new DOMException("Deserialization aborted.", "AbortError"));
        return;
      }

      if (options.signal) {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      pendingRequests.set(requestId, {
        requestId,
        requestKey,
        filePath,
        resolve: (value) =>
          finish(() =>
            resolve(Array.isArray(value) ? (value as unknown[]) : []),
          ),
        reject: (error) => finish(() => reject(error)),
        cleanup,
      });

      latestRequestIdByKey.set(requestKey, requestId);
      rejectSupersededRequestsForKey(requestKey, requestId);

      const payload: DeserializeMarkdownWorkerRequest = {
        type: "deserialize",
        requestId,
        filePath,
        markdown,
      };

      try {
        worker.postMessage(payload as MarkdownWorkerRequest);
      } catch (error) {
        finish(() => {
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to post worker message."),
          );
        });
      }
    });
  } catch (error) {
    return runFallbackValue(options.fallback, error);
  }
}

export function preloadEditorMarkdownWorker() {
  if (typeof Worker === "undefined") return;

  try {
    getWorker();
  } catch {
    // Ignore preload failures. Callers can still use the fallback path later.
  }
}

export async function serializeMarkdownInWorker(
  children: unknown,
  options: SerializeMarkdownInWorkerOptions = {},
): Promise<string> {
  if (typeof Worker === "undefined") {
    return runFallback(
      options.fallback,
      new Error("Web Workers are not available in this environment."),
    );
  }

  const filePath = normalizeFilePath(options.filePath);
  const requestKey = resolveRequestKey(options.requestKey, filePath);

  try {
    const worker = getWorker();
    const requestId = nextRequestId++;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return await new Promise<string>((resolve, reject) => {
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const timeoutId =
        timeoutMs > 0
          ? window.setTimeout(() => {
              finish(() => {
                cleanupRequest(requestId);
                reject(
                  new Error(
                    `Editor markdown worker timed out after ${timeoutMs}ms.`,
                  ),
                );
              });
            }, timeoutMs)
          : null;

      const abortHandler = () => {
        finish(() => {
          cleanupRequest(requestId);
          reject(new DOMException("Serialization aborted.", "AbortError"));
        });
      };

      const cleanup = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }

        if (options.signal) {
          options.signal.removeEventListener("abort", abortHandler);
        }

        cleanupRequest(requestId);
      };

      if (options.signal?.aborted) {
        cleanup();
        reject(new DOMException("Serialization aborted.", "AbortError"));
        return;
      }

      if (options.signal) {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      pendingRequests.set(requestId, {
        requestId,
        requestKey,
        filePath,
        resolve: (value) =>
          finish(() => resolve(typeof value === "string" ? value : "")),
        reject: (error) => finish(() => reject(error)),
        cleanup,
      });

      latestRequestIdByKey.set(requestKey, requestId);
      rejectSupersededRequestsForKey(requestKey, requestId);
      lastLegacyRequestId = requestId;

      const payload: SerializeMarkdownWorkerRequest = {
        type: "serialize",
        requestId,
        filePath,
        children,
      };

      try {
        worker.postMessage(payload);
      } catch (error) {
        finish(() => {
          cleanup();
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to post worker message."),
          );
        });
      }
    });
  } catch (error) {
    return runFallback(options.fallback, error);
  }
}

export function terminateEditorMarkdownWorker() {
  rejectAllPendingRequests(
    new Error("Editor markdown worker was terminated before completion."),
  );
  resetWorkerInstance();
}
