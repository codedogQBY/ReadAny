/**
 * Debounce utility — delays function execution until `delay` ms after the last call.
 * Supports emitLast option to ensure the final call is always executed.
 */
// biome-ignore lint: generic function signature needs any for flexibility
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
  options?: { emitLast?: boolean },
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emitLast = options?.emitLast ?? true;

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (emitLast) fn(...args);
    }, delay);
  };
}
