/**
 * useDrag — generic mouse + touch drag hook
 */
import { useRef, useCallback, useEffect } from "react";

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  velocity: number;
}

interface UseDragOptions {
  onDragStart?: (state: DragState) => void;
  onDragMove?: (state: DragState) => void;
  onDragEnd?: (state: DragState) => void;
  threshold?: number; // min pixels before drag starts
}

export function useDrag(options: UseDragOptions = {}) {
  const { onDragStart, onDragMove, onDragEnd, threshold = 5 } = options;
  const stateRef = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    velocity: 0,
  });
  const lastTimeRef = useRef(0);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      stateRef.current = {
        isDragging: false,
        startX: clientX,
        startY: clientY,
        deltaX: 0,
        deltaY: 0,
        velocity: 0,
      };
      lastTimeRef.current = Date.now();
      lastPosRef.current = { x: clientX, y: clientY };
      void threshold;
    },
    [threshold],
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      const state = stateRef.current;
      const deltaX = clientX - state.startX;
      const deltaY = clientY - state.startY;

      if (!state.isDragging && Math.abs(deltaX) + Math.abs(deltaY) < threshold) {
        return;
      }

      const now = Date.now();
      const dt = now - lastTimeRef.current;
      const dx = clientX - lastPosRef.current.x;
      const velocity = dt > 0 ? dx / dt : 0;

      stateRef.current = { ...state, isDragging: true, deltaX, deltaY, velocity };
      lastTimeRef.current = now;
      lastPosRef.current = { x: clientX, y: clientY };

      if (!state.isDragging) {
        onDragStart?.(stateRef.current);
      }
      onDragMove?.(stateRef.current);
    },
    [threshold, onDragStart, onDragMove],
  );

  const handleEnd = useCallback(() => {
    if (stateRef.current.isDragging) {
      onDragEnd?.(stateRef.current);
    }
    stateRef.current = { ...stateRef.current, isDragging: false };
  }, [onDragEnd]);

  const bind = useCallback(
    () => ({
      onMouseDown: (e: React.MouseEvent) => handleStart(e.clientX, e.clientY),
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
      },
    }),
    [handleStart],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    };
    const onEnd = () => handleEnd();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onEnd);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [handleMove, handleEnd]);

  return { bind, state: stateRef.current };
}
