/**
 * Timers that keep working when the screen is off.
 *
 * With the New Architecture every React Native timer, even `setTimeout(fn, 0)`, is fired from
 * a display frame callback (JavaTimerManager). A locked phone produces no frames, so a plain
 * `await new Promise(r => setTimeout(r, 0))` never resolves and any loop that yields this way
 * freezes, even inside a foreground service.
 *
 * These helpers skip the wait while the app is not active, and release waits that are already
 * pending the moment the app leaves the foreground. Waits here are only pacing (letting the UI
 * repaint, showing a "done" tick), so finishing them early is harmless.
 */

export interface ActivitySource {
  isActive(): boolean;
  /** Calls `listener` whenever the app becomes active or inactive; returns an unsubscribe. */
  subscribe(listener: (active: boolean) => void): () => void;
}

export function createBackgroundAwareTimers(source: ActivitySource) {
  const pending = new Set<() => void>();

  source.subscribe((active) => {
    if (active) return;
    for (const finish of [...pending]) finish();
  });

  /** Resolves after `ms`, immediately if the app is not active, or as soon as it stops being active. */
  function wait(ms: number): Promise<void> {
    if (!source.isActive()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pending.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      pending.add(finish);
    });
  }

  return { wait, yieldToUi: () => wait(0) };
}
