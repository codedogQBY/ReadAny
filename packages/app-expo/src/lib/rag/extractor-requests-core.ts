/**
 * Plumbing for the hidden extractor WebView that reads chapters out of a book file.
 *
 * Kept free of React Native so it can be tested.
 *
 * React Native (New Architecture) delivers `WebView.injectJavaScript` as a view command,
 * and view commands are only executed from a display frame callback. With the app in the
 * background or the screen off there are no frames, so the command sits in a queue until the
 * app comes back. A queue of several books therefore stalled at the second book: the first
 * was handed to the WebView while the app was still visible, the next one never arrived.
 * Messages in the other direction (WebView to JS) are not frame-bound and keep working.
 *
 * `sendScript` hands the script to a native bridge that is not tied to frames when one is
 * available, and `createRequestTracker` pairs each answer with its request so that a late or
 * duplicated answer can never settle the wrong book.
 */

export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: TimerApi = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: unknown;
}

export interface RequestTrackerOptions {
  timeoutMs: number;
  timeoutMessage: string;
  timers?: TimerApi;
}

export interface RequestTracker<T> {
  /** Registers a request; the promise settles on `resolve`/`reject` or when the timeout hits. */
  begin(): { id: string; promise: Promise<T> };
  /**
   * Settles the request with this id. Without an id (an older reader build that does not
   * echo it) the oldest request is settled. Returns false when nothing was waiting for it.
   */
  resolve(id: string | undefined, value: T): boolean;
  reject(id: string | undefined, error: Error): boolean;
  rejectAll(error: Error): void;
  readonly size: number;
}

export function createRequestTracker<T>(options: RequestTrackerOptions): RequestTracker<T> {
  const timers = options.timers ?? defaultTimers;
  const pending = new Map<string, PendingRequest<T>>();
  let counter = 0;

  function take(id: string | undefined): PendingRequest<T> | undefined {
    const key = id ?? pending.keys().next().value;
    if (key === undefined) return undefined;
    const request = pending.get(key);
    if (!request) return undefined;
    pending.delete(key);
    timers.clearTimeout(request.timer);
    return request;
  }

  return {
    begin() {
      const id = `extract-${++counter}`;
      const promise = new Promise<T>((resolve, reject) => {
        const timer = timers.setTimeout(() => {
          if (pending.delete(id)) reject(new Error(options.timeoutMessage));
        }, options.timeoutMs);
        pending.set(id, { resolve, reject, timer });
      });
      return { id, promise };
    },
    resolve(id, value) {
      const request = take(id);
      request?.resolve(value);
      return request !== undefined;
    },
    reject(id, error) {
      const request = take(id);
      request?.reject(error);
      return request !== undefined;
    },
    rejectAll(error) {
      for (const id of [...pending.keys()]) take(id)?.reject(error);
    },
    get size() {
      return pending.size;
    },
  };
}

export interface ScriptSenderDeps {
  /**
   * Runs a script in the WebView through a path that does not wait for a display frame
   * (Android native bridge). Null where there is none.
   */
  native: ((script: string) => Promise<void>) | null;
  /** The regular `WebView.injectJavaScript`; only delivered while the app draws frames. */
  command: (script: string) => void;
  isAppActive: () => boolean;
  warn?: (message: string, error?: unknown) => void;
}

export type ScriptTransport = "native" | "command";

/** Delivers `script` to the WebView and reports which route it took. */
export async function sendScript(deps: ScriptSenderDeps, script: string): Promise<ScriptTransport> {
  if (deps.native) {
    try {
      await deps.native(script);
      return "native";
    } catch (error) {
      deps.warn?.("Native WebView bridge failed, using the regular command", error);
    }
  }
  if (!deps.isAppActive()) {
    // The command would only be delivered once the app is visible again, long after the
    // caller's timeout. Fail now so the run can report it and resume later.
    throw new Error("The book reader cannot be reached while the app is in the background");
  }
  deps.command(script);
  return "command";
}
