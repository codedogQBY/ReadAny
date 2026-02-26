/**
 * Throttle utility — limits function execution to at most once per `interval` ms.
 * Supports emitLast option to ensure the final call is always executed.
 */
// biome-ignore lint: generic function signature needs any for flexibility
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  interval: number,
  options?: { emitLast?: boolean },
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emitLast = options?.emitLast ?? true;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = interval - (now - lastTime);

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastTime = now;
      fn(...args);
    } else if (emitLast && !timer) {
      timer = setTimeout(() => {
        lastTime = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}
