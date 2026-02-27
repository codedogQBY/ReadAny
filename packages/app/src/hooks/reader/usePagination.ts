/**
 * usePagination — handles page flip and scroll navigation via
 * mouse events and touch events from iframe bridge.
 *
 * Strategy: Leading-edge throttle with "idle unlock".
 * - The FIRST wheel event triggers an immediate page turn (zero latency).
 * - All subsequent events are swallowed.
 * - The lock is released only after NO wheel events have arrived for
 *   WHEEL_IDLE_MS, ensuring trackpad inertia is fully drained.
 * - A minimum cooldown (WHEEL_MIN_COOLDOWN_MS) prevents re-triggering
 *   even if the user flicks quickly.
 */
import { useCallback, useEffect, useRef } from "react";
import type { FoliateView } from "./useFoliateView";

interface UsePaginationOptions {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/** Minimum cooldown after a page turn (ms) */
const WHEEL_MIN_COOLDOWN_MS = 350;

/** After the last wheel event, wait this long before unlocking (ms).
 *  This drains trackpad inertia completely. */
const WHEEL_IDLE_MS = 200;

export function usePagination({
  bookKey,
  viewRef,
  containerRef,
}: UsePaginationOptions) {
  const wheelLocked = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTime = useRef(0);

  /** Handle mouse-click-based page flip (click on left/right thirds) */
  const handlePageFlip = useCallback(
    (clientX: number, _clientY: number) => {
      const view = viewRef.current;
      const container = containerRef.current;
      if (!view || !container) return;

      const rect = container.getBoundingClientRect();
      const relX = clientX - rect.left;
      const width = rect.width;

      if (relX < width * 0.3) {
        view.goLeft();
      } else if (relX > width * 0.7) {
        view.goRight();
      }
    },
    [viewRef, containerRef],
  );

  /**
   * Handle wheel event with leading-edge throttle + idle unlock:
   * - First event → immediate page turn
   * - While locked → reset idle timer on every event (keeps draining inertia)
   * - Unlock only when idle for WHEEL_IDLE_MS AND at least WHEEL_MIN_COOLDOWN_MS passed
   */
  const handleWheel = useCallback(
    (deltaY: number, deltaX?: number) => {
      const view = viewRef.current;
      if (!view) return;

      // In scroll mode, let native scroll handle it
      if (view.renderer?.scrolled) return;

      // Ignore tiny deltas (noise)
      const absDY = Math.abs(deltaY);
      const absDX = Math.abs(deltaX || 0);
      if (absDY < 2 && absDX < 2) return;

      // While locked: just keep resetting the idle timer to drain inertia
      if (wheelLocked.current) {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
          // Ensure minimum cooldown elapsed
          const elapsed = Date.now() - lockTime.current;
          if (elapsed >= WHEEL_MIN_COOLDOWN_MS) {
            wheelLocked.current = false;
          } else {
            // Wait remaining time
            idleTimer.current = setTimeout(() => {
              wheelLocked.current = false;
            }, WHEEL_MIN_COOLDOWN_MS - elapsed);
          }
        }, WHEEL_IDLE_MS);
        return;
      }

      // Determine direction from dominant axis
      let direction: "next" | "prev";
      if (absDY >= absDX) {
        direction = deltaY > 0 ? "next" : "prev";
      } else {
        direction = (deltaX || 0) > 0 ? "next" : "prev";
      }

      // Immediate page turn (zero latency)
      if (direction === "next") {
        view.next();
      } else {
        view.prev();
      }

      // Lock and start idle monitoring
      wheelLocked.current = true;
      lockTime.current = Date.now();
      idleTimer.current = setTimeout(() => {
        wheelLocked.current = false;
      }, WHEEL_IDLE_MS);
    },
    [viewRef],
  );

  // Cleanup idle timer on unmount
  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Listen for bridged iframe events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type || data.bookKey !== bookKey) return;

      switch (data.type) {
        case "iframe-click":
          handlePageFlip(data.clientX, data.clientY);
          break;
        case "iframe-wheel":
          handleWheel(data.deltaY, data.deltaX);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bookKey, handlePageFlip, handleWheel]);

  // Also listen for main-window wheel events on container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      handleWheel(e.deltaY, e.deltaX);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef, handleWheel]);

  return { handlePageFlip, handleWheel };
}
