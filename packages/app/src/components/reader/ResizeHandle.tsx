/**
 * ResizeHandle — a draggable edge handle for resizing panels.
 *
 * Place this at the border of a panel. Emits onResizeStart once,
 * onResize(delta) continuously, and onResizeEnd when released.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  /** Which side of the panel the handle sits on */
  side: "left" | "right";
  /** Called once when drag starts */
  onResizeStart?: () => void;
  /** Called continuously while dragging. `delta` is px moved from drag start (positive = towards right). */
  onResize: (delta: number) => void;
  /** Called when drag ends */
  onResizeEnd?: () => void;
  className?: string;
}

export function ResizeHandle({
  side,
  onResizeStart,
  onResize,
  onResizeEnd,
  className,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const didStartRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    didStartRef.current = false;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      if (!didStartRef.current) {
        didStartRef.current = true;
        onResizeStart?.();
      }
      const delta = e.clientX - startXRef.current;
      onResize(delta);
    },
    [isDragging, onResize, onResizeStart],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setIsDragging(false);
      didStartRef.current = false;
      onResizeEnd?.();
    },
    [isDragging, onResizeEnd],
  );

  // Prevent text selection while dragging
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }

    return () => {
      // Always cleanup on unmount or when isDragging changes
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  // Cleanup on unmount (component might unmount while dragging)
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <div
      className={`
        group absolute top-0 bottom-0 z-30 flex w-2 cursor-col-resize items-center justify-center
        ${side === "left" ? "-left-1" : "-right-1"}
        ${className ?? ""}
      `}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Visible drag indicator */}
      <div
        className={`
          h-8 w-1 rounded-full transition-colors duration-150
          ${isDragging ? "bg-primary/60" : "bg-transparent group-hover:bg-muted-foreground/30"}
        `}
      />
    </div>
  );
}
