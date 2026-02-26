import { useReaderStore } from "@/stores/reader-store";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface FooterBarProps {
  tabId: string;
  totalPages: number;
  currentPage: number;
  onPrev: () => void;
  onNext: () => void;
}

export function FooterBar({ tabId, totalPages, currentPage, onPrev, onNext }: FooterBarProps) {
  const tab = useReaderStore((s) => s.tabs[tabId]);
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  const progress = tab?.progress ?? 0;
  const pct = Math.round(progress * 100);

  return (
    <div
      className={`relative z-30 transition-all duration-300 ${visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"}`}
      onMouseEnter={() => {
        setVisible(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
      }}
      onMouseLeave={resetHideTimer}
    >
      {/* Hover trigger zone */}
      <div
        className="absolute bottom-0 left-0 z-40 h-3 w-full"
        onMouseEnter={() => setVisible(true)}
      />

      <div className="flex h-10 items-center justify-between border-t border-border/50 bg-background/95 px-4 backdrop-blur-sm">
        {/* Left: prev button */}
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Center: progress bar + page info */}
        <div className="flex flex-1 items-center gap-3 px-4">
          <div className="flex-1">
            <div className="h-1 rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {totalPages > 0 ? `${currentPage} / ${totalPages}` : `${pct}%`}
          </span>
        </div>

        {/* Right: next button */}
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onNext}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
