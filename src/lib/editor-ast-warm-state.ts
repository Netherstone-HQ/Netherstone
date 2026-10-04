export type AstWarmAttemptToken = number;

const warmedAstPaths = new Set<string>();
const inFlightAstWarmAttempts = new Map<string, AstWarmAttemptToken>();
const astWarmGenerationByPath = new Map<string, AstWarmAttemptToken>();
const astWarmAbortControllers = new Map<string, AbortController>();

function normalizeAstWarmPath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) return null;

  return trimmed.replace(/\\/g, "/");
}

function getNextAstWarmGeneration(filePath: string): AstWarmAttemptToken {
  const currentGeneration = astWarmGenerationByPath.get(filePath) ?? 0;
  const nextGeneration = currentGeneration + 1;

  astWarmGenerationByPath.set(filePath, nextGeneration);

  return nextGeneration;
}

function abortNormalizedAstWarmAttempt(filePath: string): void {
  const abortController = astWarmAbortControllers.get(filePath);
  if (!abortController) return;

  abortController.abort();
  astWarmAbortControllers.delete(filePath);
}

function clearNormalizedAstWarmAbortController(filePath: string): void {
  astWarmAbortControllers.delete(filePath);
}

function invalidateNormalizedAstWarmPath(filePath: string): void {
  warmedAstPaths.delete(filePath);
  inFlightAstWarmAttempts.delete(filePath);
  abortNormalizedAstWarmAttempt(filePath);
  getNextAstWarmGeneration(filePath);
}

/**
 * Starts a new background AST warm attempt for `filePath`.
 *
 * Starting a new attempt automatically supersedes any older in-flight attempt
 * for the same path.
 */
export function beginAstWarmAttempt(
  filePath: string,
): AstWarmAttemptToken | null {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return null;

  warmedAstPaths.delete(normalizedPath);
  abortNormalizedAstWarmAttempt(normalizedPath);

  const attemptToken = getNextAstWarmGeneration(normalizedPath);
  inFlightAstWarmAttempts.set(normalizedPath, attemptToken);
  astWarmAbortControllers.set(normalizedPath, new AbortController());

  return attemptToken;
}

/**
 * Returns true only while the exact warm attempt is still the active owner for
 * this path. If the path was invalidated or a newer attempt started, this
 * becomes false.
 */
export function isAstWarmAttemptCurrent(
  filePath: string,
  attemptToken: AstWarmAttemptToken,
): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;

  return (
    astWarmGenerationByPath.get(normalizedPath) === attemptToken &&
    inFlightAstWarmAttempts.get(normalizedPath) === attemptToken
  );
}

export function getAstWarmAttemptSignal(
  filePath: string,
  attemptToken: AstWarmAttemptToken,
): AbortSignal | null {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return null;
  if (!isAstWarmAttemptCurrent(normalizedPath, attemptToken)) return null;

  return astWarmAbortControllers.get(normalizedPath)?.signal ?? null;
}

/**
 * Completes the active warm attempt if it still owns the path.
 *
 * Returns false when the attempt is stale and should not publish results.
 */
export function finishAstWarmAttempt(
  filePath: string,
  attemptToken: AstWarmAttemptToken,
  options: { warmed?: boolean } = {},
): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;
  if (!isAstWarmAttemptCurrent(normalizedPath, attemptToken)) return false;

  inFlightAstWarmAttempts.delete(normalizedPath);
  clearNormalizedAstWarmAbortController(normalizedPath);

  if (options.warmed) {
    warmedAstPaths.add(normalizedPath);
  } else {
    warmedAstPaths.delete(normalizedPath);
  }

  return true;
}

/**
 * Cancels an active attempt if it still owns the path.
 */
export function cancelAstWarmAttempt(
  filePath: string,
  attemptToken: AstWarmAttemptToken,
): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;
  if (!isAstWarmAttemptCurrent(normalizedPath, attemptToken)) return false;

  abortNormalizedAstWarmAttempt(normalizedPath);
  return finishAstWarmAttempt(normalizedPath, attemptToken, { warmed: false });
}

/**
 * Invalidates cached warm-state for one or more paths.
 *
 * Use this when files change externally, are deleted, renamed, or otherwise
 * become unsafe to treat as already warmed.
 */
export function invalidateAstWarmPaths(filePaths: Iterable<string>): string[] {
  const invalidatedPaths: string[] = [];

  for (const filePath of filePaths) {
    const normalizedPath = normalizeAstWarmPath(filePath);
    if (!normalizedPath) continue;

    invalidateNormalizedAstWarmPath(normalizedPath);
    invalidatedPaths.push(normalizedPath);
  }

  return invalidatedPaths;
}

export function invalidateAstWarmPath(filePath: string): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;

  invalidateNormalizedAstWarmPath(normalizedPath);
  return true;
}

export function isAstWarmPathWarmed(filePath: string): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;

  return warmedAstPaths.has(normalizedPath);
}

export function isAstWarmPathInFlight(filePath: string): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return false;

  return inFlightAstWarmAttempts.has(normalizedPath);
}

export function shouldSkipAstWarm(filePath: string): boolean {
  const normalizedPath = normalizeAstWarmPath(filePath);
  if (!normalizedPath) return true;

  return (
    warmedAstPaths.has(normalizedPath) ||
    inFlightAstWarmAttempts.has(normalizedPath)
  );
}

export function resetAstWarmState(): void {
  for (const abortController of astWarmAbortControllers.values()) {
    abortController.abort();
  }

  warmedAstPaths.clear();
  inFlightAstWarmAttempts.clear();
  astWarmGenerationByPath.clear();
  astWarmAbortControllers.clear();
}

export function getAstWarmStateSnapshot() {
  return {
    warmedPaths: [...warmedAstPaths],
    inFlightPaths: [...inFlightAstWarmAttempts.keys()],
    abortablePaths: [...astWarmAbortControllers.keys()],
  };
}
