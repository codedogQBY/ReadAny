/**
 * usePagination — handles page flip and scroll navigation via
 * mouse events from the host container and iframe bridge.
 *
 * Strategy: Leading-edge throttle with "idle unlock".
 */
import { useCallback, useEffect, useRef } from "react";
import type { FoliateView } from "./useFoliateView";

interface UsePaginationOptions {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isFixedLayout?: boolean;
}

/** Minimum cooldown after a page turn (ms) */
const WHEEL_MIN_COOLDOWN_MS = 350;

/** After the last wheel event, wait this long before unlocking (ms). */
const WHEEL_IDLE_MS = 200;

function getScrollableDistance(element: HTMLElement, axis: "x" | "y") {
  return axis === "x"
    ? Math.max(0, element.scrollWidth - element.clientWidth)
    : Math.max(0, element.scrollHeight - element.clientHeight);
}

function scrollFixedLayoutPage(view: FoliateView, deltaY: number, deltaX = 0) {
  const renderer = view.renderer as HTMLElement | undefined;
  if (!renderer || renderer.getAttribute("spread") !== "none") return false;

  const maxY = getScrollableDistance(renderer, "y");
  const maxX = getScrollableDistance(renderer, "x");
  if (maxY <= 1 && maxX <= 1) return false;

  const beforeTop = renderer.scrollTop;
  const beforeLeft = renderer.scrollLeft;
  const top = maxY > 1 ? deltaY : 0;
  const left = maxX > 1 ? deltaX : 0;
  if (Math.abs(top) < 1 && Math.abs(left) < 1) return false;

  renderer.scrollBy({ top, left, behavior: "auto" });
  return (
    Math.abs(renderer.scrollTop - beforeTop) > 0.5 ||
    Math.abs(renderer.scrollLeft - beforeLeft) > 0.5
  );
}

export function usePagination({
  bookKey,
  viewRef,
  containerRef,
  isFixedLayout = false,
}: UsePaginationOptions) {
  const wheelLocked = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTime = useRef(0);

  const handleWheel = useCallback(
    (deltaY: number, deltaX?: number) => {
      const view = viewRef.current;
      if (!view) return;

      if (view.renderer?.scrolled) return;

      if (isFixedLayout && scrollFixedLayoutPage(view, deltaY, deltaX)) {
        return;
      }

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
    [isFixedLayout, viewRef],
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
          if (viewRef.current?.renderer?.scrolled) return;
          handleWheel(data.deltaY, data.deltaX);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bookKey, handleWheel, viewRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (viewRef.current?.renderer?.scrolled) return;
      e.preventDefault();
      handleWheel(e.deltaY, e.deltaX);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef, handleWheel, viewRef]);

  return { handleWheel };
}
