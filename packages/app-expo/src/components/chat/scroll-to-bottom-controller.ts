type ScheduleHandle = unknown;

interface ScrollToBottomControllerOptions {
  scrollToEnd: () => void;
  schedule?: (callback: () => void) => ScheduleHandle;
  cancelSchedule?: (handle: ScheduleHandle) => void;
  bottomThreshold?: number;
  maxAttempts?: number;
  onExhausted?: () => void;
}

export interface ScrollToBottomController {
  request: () => void;
  observeDistance: (distance: number) => void;
  contentSizeChanged: () => void;
  cancel: () => void;
  isPending: () => boolean;
}

export function createScrollToBottomController(
  options: ScrollToBottomControllerOptions,
): ScrollToBottomController {
  const schedule = options.schedule ?? ((callback: () => void) => setInterval(callback, 50));
  const cancelSchedule =
    options.cancelSchedule ??
    ((handle: ScheduleHandle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const bottomThreshold = options.bottomThreshold ?? 80;
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 20));

  let pending = false;
  let attempts = 0;
  let scheduleHandle: ScheduleHandle;
  let hasSchedule = false;
  let exhaustionReported = false;
  let bottomObserved = false;
  let stableBottomTicks = 0;

  const stop = () => {
    pending = false;
    if (hasSchedule) {
      cancelSchedule(scheduleHandle);
      hasSchedule = false;
    }
  };

  const exhaust = () => {
    stop();
    if (!exhaustionReported) {
      exhaustionReported = true;
      options.onExhausted?.();
    }
  };

  const attempt = () => {
    if (!pending) return;

    if (bottomObserved) {
      stableBottomTicks += 1;
      if (stableBottomTicks >= 2) {
        stop();
        return;
      }
      options.scrollToEnd();
      return;
    }

    stableBottomTicks = 0;
    if (attempts >= maxAttempts) {
      exhaust();
      return;
    }

    attempts += 1;
    options.scrollToEnd();
  };

  const cancel = () => {
    stop();
  };

  return {
    request() {
      cancel();
      pending = true;
      attempts = 0;
      exhaustionReported = false;
      bottomObserved = false;
      stableBottomTicks = 0;
      attempt();

      const handle = schedule(attempt);
      if (pending) {
        scheduleHandle = handle;
        hasSchedule = true;
      } else {
        cancelSchedule(handle);
      }
    },
    observeDistance(distance) {
      if (!pending) return;
      bottomObserved = Number.isFinite(distance) && distance < bottomThreshold;
      if (!bottomObserved) stableBottomTicks = 0;
    },
    contentSizeChanged() {
      if (!pending) return;
      bottomObserved = false;
      stableBottomTicks = 0;
      options.scrollToEnd();
    },
    cancel,
    isPending() {
      return pending;
    },
  };
}
