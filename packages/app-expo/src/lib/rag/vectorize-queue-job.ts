import { type ChapterData, VectorizationCleanupError } from "@readany/core/rag";
import {
  BookExtractionError,
  type BookExtractionErrorCategory,
  toBookExtractionError,
} from "./extractor-error";

export type VectorizeQueueJobEvent<Progress> =
  | { status: "extracting" }
  | { status: "vectorizing"; progress?: Progress }
  | { status: "completed" }
  | { status: "cancelled" }
  | {
      status: "error";
      error: unknown;
      errorCategory?: BookExtractionErrorCategory;
      cleanupError?: unknown;
    };

export type VectorizeQueueJobResult =
  | { ok: true }
  | { ok: false; error: unknown; cancelled?: boolean; cleanupError?: unknown };

interface VectorizeQueueJobOptions<Progress> {
  format?: string;
  signal?: AbortSignal;
  extract: (signal: AbortSignal) => Promise<ChapterData[]>;
  vectorize: (
    chapters: ChapterData[],
    onProgress: ((progress: Progress) => void) | undefined,
    signal: AbortSignal,
  ) => Promise<void>;
  cleanup: () => Promise<void>;
  onEvent: (event: VectorizeQueueJobEvent<Progress>) => void;
}

function createFallbackSignal(): AbortSignal {
  return new AbortController().signal;
}

export function throwIfQueueJobAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) {
    if (reason.name !== "AbortError") reason.name = "AbortError";
    throw reason;
  }
  const error = new Error("Vectorization cancelled");
  error.name = "AbortError";
  throw error;
}

function isAbortFailure(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

function isTerminalProgress(progress: unknown): boolean {
  return (
    typeof progress === "object" &&
    progress !== null &&
    "status" in progress &&
    (progress.status === "completed" ||
      progress.status === "error" ||
      progress.status === "cancelled")
  );
}

export async function runVectorizeQueueJob<Progress>(
  options: VectorizeQueueJobOptions<Progress>,
): Promise<VectorizeQueueJobResult> {
  let phase: "extracting" | "vectorizing" = "extracting";
  const signal = options.signal ?? createFallbackSignal();
  options.onEvent({ status: "extracting" });

  try {
    throwIfQueueJobAborted(signal);
    const chapters = await options.extract(signal);
    throwIfQueueJobAborted(signal);
    if (!chapters.length) {
      throw toBookExtractionError(new Error("No chapters extracted from book"), options.format);
    }

    phase = "vectorizing";
    options.onEvent({ status: "vectorizing" });
    await options.vectorize(
      chapters,
      (progress) => {
        if (!isTerminalProgress(progress)) {
          options.onEvent({ status: "vectorizing", progress });
        }
      },
      signal,
    );
    throwIfQueueJobAborted(signal);

    options.onEvent({ status: "completed" });
    return { ok: true };
  } catch (error) {
    const failure = phase === "extracting" ? toBookExtractionError(error, options.format) : error;
    let cleanupError = error instanceof VectorizationCleanupError ? error.cleanupError : undefined;
    if (phase === "extracting") {
      try {
        await options.cleanup();
      } catch (errorDuringCleanup) {
        cleanupError = errorDuringCleanup;
      }
    }
    const cancelled = !cleanupError && isAbortFailure(error, signal);

    if (cancelled) {
      options.onEvent({ status: "cancelled" });
    } else {
      options.onEvent({
        status: "error",
        error: failure,
        errorCategory: failure instanceof BookExtractionError ? failure.category : undefined,
        cleanupError,
      });
    }
    return cleanupError
      ? { ok: false, error: failure, cancelled, cleanupError }
      : { ok: false, error: failure, cancelled };
  }
}
