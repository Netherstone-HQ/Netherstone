const EDITOR_LIFECYCLE_LOG_PREFIX = "[Netherstone][Editor Lifecycle]";

export type EditorLifecycleDetails = Record<string, unknown>;

export function getEditorLifecycleNowMs(): number {
  return typeof window !== "undefined" && "performance" in window
    ? window.performance.now()
    : Date.now();
}

export function getEditorLifecycleDurationMs(startMs: number): number {
  return Math.round((getEditorLifecycleNowMs() - startMs) * 100) / 100;
}

export function formatEditorLifecycleDurationMs(startMs: number): string {
  return `${getEditorLifecycleDurationMs(startMs)}ms`;
}

export function logEditorLifecycle(
  event: string,
  details: EditorLifecycleDetails = {},
): void {
  console.info(EDITOR_LIFECYCLE_LOG_PREFIX, event, details);
}

export function getPlateValueNodeCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
