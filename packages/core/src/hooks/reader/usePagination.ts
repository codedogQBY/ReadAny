/**
 * usePagination — handles page flip and scroll navigation via
 * mouse events and touch events from iframe bridge.
 *
 * Strategy: Leading-edge throttle with "idle unlock".
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

/** After the last wheel event, wait this long before unlocking (ms). */
const WHEEL_IDLE_MS = 200;

export function usePagination({ bookKey, viewRef, containerRef }: UsePaginationOptions) {
  const wheelLocked = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTime = useRef(0);

  const isRendererScrolled = useCallback(
    () => Boolean(viewRef.current?.renderer?.scrolled),
    [viewRef],
  );

  const handleWheel = useCallback(
    (deltaY: number, deltaX?: number) => {
      const view = viewRef.current;
      if (!view) return;

      if (isRendererScrolled()) return;

      const absDY = Math.abs(deltaY);
      const absDX = Math.abs(deltaX || 0);
      if (absDY < 2 && absDX < 2) return;

      if (wheelLocked.current) {
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
          const elapsed = Date.now() - lockTime.current;
          if (elapsed >= WHEEL_MIN_COOLDOWN_MS) {
            wheelLocked.current = false;
          } else {
            idleTimer.current = setTimeout(() => {
              wheelLocked.current = false;
            }, WHEEL_MIN_COOLDOWN_MS - elapsed);
          }
        }, WHEEL_IDLE_MS);
        return;
      }

      let direction: "next" | "prev";
      if (absDY >= absDX) {
        direction = deltaY > 0 ? "next" : "prev";
      } else {
        direction = (deltaX || 0) > 0 ? "next" : "prev";
      }

      if (direction === "next") {
        view.next();
      } else {
        view.prev();
      }

      wheelLocked.current = true;
      lockTime.current = Date.now();
      idleTimer.current = setTimeout(() => {
        wheelLocked.current = false;
      }, WHEEL_IDLE_MS);
    },
    [isRendererScrolled, viewRef],
  );

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type || data.bookKey !== bookKey) return;

      switch (data.type) {
        case "iframe-wheel":
          handleWheel(data.deltaY, data.deltaX);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bookKey, handleWheel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (isRendererScrolled()) return;
      e.preventDefault();
      handleWheel(e.deltaY, e.deltaX);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef, handleWheel, isRendererScrolled]);

  return { handleWheel };
}
