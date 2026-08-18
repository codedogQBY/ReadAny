interface ExtractorRequestBoundaryOptions {
  timeoutMs: number;
  sendCancel: (requestId: string) => void;
  onCancelError?: (requestId: string, error: unknown) => void;
}

interface AddExtractorRequest<Result, Context> {
  requestId: string;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
  timeoutError: () => Error;
  disposeError?: () => Error;
  signal?: AbortSignal;
  abortError?: () => Error;
  context?: Context;
}

interface PendingExtractorRequest<Result, Context> extends AddExtractorRequest<Result, Context> {
  timeoutId: ReturnType<typeof setTimeout>;
  abortHandler?: () => void;
}

function defaultAbortError(): Error {
  const error = new Error("Vectorization cancelled");
  error.name = "AbortError";
  return error;
}

/** Owns RN pending requests and their cancellation notification to the reader. */
export class ExtractorRequestBoundary<Result, Context = unknown> {
  private readonly requests = new Map<string, PendingExtractorRequest<Result, Context>>();

  constructor(private readonly options: ExtractorRequestBoundaryOptions) {}

  add(request: AddExtractorRequest<Result, Context>): void {
    if (this.requests.has(request.requestId)) {
      throw new Error(`Duplicate extractor request: ${request.requestId}`);
    }

    const pending: PendingExtractorRequest<Result, Context> = {
      ...request,
      timeoutId: setTimeout(() => {
        this.cancel(request.requestId, request.timeoutError());
      }, this.options.timeoutMs),
    };
    this.requests.set(request.requestId, pending);

    if (request.signal) {
      pending.abortHandler = () => {
        this.cancel(request.requestId, request.abortError?.() ?? defaultAbortError());
      };
      if (request.signal.aborted) pending.abortHandler();
      else request.signal.addEventListener("abort", pending.abortHandler, { once: true });
    }
  }

  has(requestId: string): boolean {
    return this.requests.has(requestId);
  }

  getContext(requestId: string): Context | undefined {
    return this.requests.get(requestId)?.context;
  }

  resolve(requestId: string, result: Result): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.resolve(result);
    return true;
  }

  reject(requestId: string, error: Error): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    pending.reject(error);
    return true;
  }

  cancel(requestId: string, error: Error): boolean {
    const pending = this.take(requestId);
    if (!pending) return false;
    try {
      this.options.sendCancel(requestId);
    } catch (cancelError) {
      this.options.onCancelError?.(requestId, cancelError);
    }
    pending.reject(error);
    return true;
  }

  rejectAll(): void {
    for (const requestId of [...this.requests.keys()]) {
      const pending = this.take(requestId);
      if (pending) pending.reject(pending.disposeError?.() ?? new Error("Extractor disposed"));
    }
  }

  private take(requestId: string): PendingExtractorRequest<Result, Context> | undefined {
    const pending = this.requests.get(requestId);
    if (!pending) return undefined;
    this.requests.delete(requestId);
    clearTimeout(pending.timeoutId);
    if (pending.abortHandler) {
      pending.signal?.removeEventListener("abort", pending.abortHandler);
    }
    return pending;
  }
}
