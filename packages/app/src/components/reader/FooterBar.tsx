import { useReaderStore } from "@/stores/reader-store";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface FooterBarProps {
  tabId: string;
  totalPages: number;
  currentPage: number;
  isVisible: boolean;
  onPrev: () => void;
  onNext: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function FooterBar({
  tabId,
  totalPages,
  currentPage,
  isVisible,
  onPrev,
  onNext,
  onMouseEnter,
  onMouseLeave,
}: FooterBarProps) {
  const tab = useReaderStore((s) => s.tabs[tabId]);

  const progress = tab?.progress ?? 0;
  const pct = Math.round(progress * 100);

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-50 flex h-10 items-center justify-between bg-background/95 backdrop-blur-sm px-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] transition-all duration-300 ${
        isVisible
          ? "translate-y-0 opacity-100 pointer-events-auto"
          : "translate-y-full opacity-0 pointer-events-none"
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Left: prev button */}
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
        onClick={onPrev}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Center: page info */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {totalPages > 0 ? `${currentPage} / ${totalPages}` : `${pct}%`}
        </span>
      </div>

      {/* Right: next button */}
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
        onClick={onNext}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
