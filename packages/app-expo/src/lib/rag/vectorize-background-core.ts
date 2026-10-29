/**
 * Keeps book vectorization running while the phone is locked or the app is in the
 * background (Android).
 *
 * Android freezes a backgrounded app, and React Native stops its JS timers with it, so a
 * long run stalled as soon as the screen turned off. A foreground service with a visible
 * progress notification (and a headless JS task, which keeps timers ticking and holds a
 * wake lock) prevents that. When the work ends while the app is hidden, a normal
 * notification reports the result.
 *
 * Everything platform-specific is injected so the logic can be tested without React Native;
 * `vectorize-background.ts` supplies the real implementations.
 */

export type BackgroundTextKey = "title" | "progress" | "doneTitle" | "doneBody" | "partialBody";

export interface BackgroundServiceLike {
  start(
    task: () => Promise<void>,
    options: {
      taskName: string;
      taskTitle: string;
      taskDesc: string;
      taskIcon: { name: string; type: string };
      color: string;
      progressBar: { max: number; value: number; indeterminate?: boolean };
      foregroundServiceType: "dataSync"[];
    },
  ): Promise<void>;
  updateNotification(data: {
    taskTitle?: string;
    taskDesc?: string;
    progressBar?: { max: number; value: number; indeterminate?: boolean };
  }): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface ResultNotifierLike {
  /** Ask for notification permission; must not throw and should only ever prompt once. */
  ensurePermission(): Promise<void>;
  notify(title: string, body: string): Promise<void>;
}

export interface BackgroundVectorizeDeps {
  isAndroid: boolean;
  service: BackgroundServiceLike;
  notifier: ResultNotifierLike;
  text: (key: BackgroundTextKey, params?: Record<string, string | number>) => string;
  isAppForeground: () => boolean;
  now?: () => number;
}

export interface BackgroundVectorizeHandle {
  /** A book starts; `index` is 0-based, `total` is how many books are queued in all. */
  bookStarted(title: string, index: number, total: number): void;
  /** Progress of the current book, 0-1. */
  bookProgress(fraction: number): void;
  bookFinished(ok: boolean): void;
  /** The caller's queue is done; the service stops when the last caller releases. */
  release(): Promise<void>;
}

/** Notification updates are rate-limited: they are IPC calls and the system throttles them. */
export const MIN_UPDATE_INTERVAL_MS = 1000;

export function toPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

export function shouldPushUpdate(
  last: { at: number; percent: number } | null,
  next: { at: number; percent: number },
  force = false,
): boolean {
  if (force || !last) return true;
  if (next.percent === last.percent) return false;
  return next.at - last.at >= MIN_UPDATE_INTERVAL_MS;
}

const NOOP_HANDLE: BackgroundVectorizeHandle = {
  bookStarted() {},
  bookProgress() {},
  bookFinished() {},
  async release() {},
};

export function createBackgroundVectorize(deps: BackgroundVectorizeDeps) {
  const now = deps.now ?? Date.now;
  let holders = 0;
  let starting: Promise<boolean> | null = null;
  let running = false;
  let releaseKeepAlive: (() => void) | null = null;
  let stats = { done: 0, failed: 0 };
  let current = { title: "", index: 0, total: 1 };
  let lastPushed: { at: number; percent: number } | null = null;
  let percent = 0;

  const progressText = () =>
    deps.text("progress", {
      title: current.title,
      percent,
      current: Math.min(current.index + 1, current.total),
      total: current.total,
    });

  async function push(force: boolean) {
    if (!running || !deps.service.isRunning()) return;
    const next = { at: now(), percent };
    if (!shouldPushUpdate(lastPushed, next, force)) return;
    lastPushed = next;
    try {
      await deps.service.updateNotification({
        taskTitle: deps.text("title"),
        taskDesc: progressText(),
        progressBar: { max: 100, value: percent },
      });
    } catch (err) {
      console.warn("[VectorizeBackground] Could not update the notification:", err);
    }
  }

  async function startService(): Promise<boolean> {
    if (!deps.isAndroid) return false;
    try {
      // Not awaited: the permission dialog must not delay starting the work.
      void deps.notifier.ensurePermission();
      await deps.service.start(
        () =>
          new Promise<void>((resolve) => {
            releaseKeepAlive = resolve;
          }),
        {
          taskName: "ReadAnyVectorize",
          taskTitle: deps.text("title"),
          taskDesc: deps.text("title"),
          taskIcon: { name: "ic_launcher", type: "mipmap" },
          color: "#8b5a2b",
          progressBar: { max: 100, value: 0, indeterminate: true },
          foregroundServiceType: ["dataSync"],
        },
      );
      running = true;
      console.log("[VectorizeBackground] Foreground service started");
      return true;
    } catch (err) {
      // Vectorization still works in the foreground without the service.
      console.warn("[VectorizeBackground] Could not start the background service:", err);
      return false;
    }
  }

  async function stopService() {
    const summary = { ...stats };
    running = false;
    lastPushed = null;
    stats = { done: 0, failed: 0 };
    releaseKeepAlive?.();
    releaseKeepAlive = null;
    try {
      await deps.service.stop();
    } catch (err) {
      console.warn("[VectorizeBackground] Could not stop the background service:", err);
    }
    const total = summary.done + summary.failed;
    console.log(
      `[VectorizeBackground] Foreground service stopped (${summary.done} done, ${summary.failed} failed)`,
    );
    if (total === 0 || deps.isAppForeground()) return;
    try {
      await deps.notifier.notify(
        deps.text("doneTitle"),
        summary.failed === 0
          ? deps.text("doneBody", { done: summary.done, total })
          : deps.text("partialBody", { done: summary.done, failed: summary.failed }),
      );
    } catch (err) {
      console.warn("[VectorizeBackground] Could not post the result notification:", err);
    }
  }

  async function acquire(): Promise<BackgroundVectorizeHandle> {
    holders++;
    if (!running) {
      starting ??= startService();
      const started = await starting;
      starting = null;
      if (!started) {
        holders--;
        return NOOP_HANDLE;
      }
    }

    let released = false;
    return {
      bookStarted(title, index, total) {
        current = { title, index, total: Math.max(total, index + 1) };
        percent = 0;
        void push(true);
      },
      bookProgress(fraction) {
        percent = toPercent(fraction);
        void push(false);
      },
      bookFinished(ok) {
        if (ok) stats.done++;
        else stats.failed++;
      },
      async release() {
        if (released) return;
        released = true;
        holders--;
        if (holders === 0) await stopService();
      },
    };
  }

  return { acquire };
}
