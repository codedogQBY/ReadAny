const RETRYABLE_DB_ERROR_PATTERNS = ["database is locked", "another row available"];
let writeQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableDbError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_DB_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Wait for an in-flight sync to settle before writing. Capped low on purpose:
 * the UI must never stall behind a long-running sync (a full first sync can
 * run for many minutes). Genuine SQLite lock contention is handled by the
 * retry loop in runWithDbRetry instead.
 */
export async function waitForSyncToSettle(timeoutMs = 1500): Promise<void> {
  try {
    const { useSyncStore } = await import("../stores/sync-store");
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const status = useSyncStore.getState().status;
      if (status === "idle" || status === "error") {
        return;
      }
      await sleep(200);
    }
  } catch {
    // Ignore if sync store is unavailable in the current environment.
  }
}

export async function runWithDbRetry<T>(
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    initialDelayMs?: number;
    waitForSync?: boolean;
  },
): Promise<T> {
  const attempts = options?.attempts ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 80;
  const waitForSync = options?.waitForSync ?? true;
  let lastError: unknown;

  const run = async (): Promise<T> => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (waitForSync) {
          await waitForSyncToSettle();
        }
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableDbError(error) || attempt === attempts) {
          throw error;
        }
        await sleep(initialDelayMs * attempt);
      }
    }
    throw lastError;
  };

  const queuedRun = writeQueue.then(run, run);
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  );
  return queuedRun;
}

export async function runSerializedDbTask<T>(operation: () => Promise<T>): Promise<T> {
  const queuedRun = writeQueue.then(operation, operation);
  writeQueue = queuedRun.then(
    () => undefined,
    () => undefined,
  );
  return queuedRun;
}
