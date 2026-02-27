/**
 * Citation Card Component — clickable citation that can navigate to book location
 * Shows a brief preview on hover, click to jump to the location
 */
import { cn } from "@/lib/utils";
import { BookOpen, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import type { Citation } from "@/types/chat";

interface CitationCardProps {
  citation: Citation;
  onNavigate?: (citation: Citation) => void;
  className?: string;
  compact?: boolean;
}

export function CitationCard({ citation, onNavigate, className, compact = false }: CitationCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    onNavigate?.(citation);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
          "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800",
          className
        )}
      >
        <FileText className="h-3 w-3" />
        <span className="max-w-32 truncate">{citation.chapterTitle}</span>
      </button>
    );
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "group cursor-pointer rounded-lg border border-neutral-200 bg-white p-3 transition-all",
        "hover:border-neutral-300 hover:shadow-sm",
        isHovered && "border-blue-200 bg-blue-50/30",
        className
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <BookOpen className="h-3.5 w-3.5" />
          <span className="font-medium">{citation.chapterTitle}</span>
        </div>
        <ExternalLink
          className={cn(
            "h-3.5 w-3.5 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100",
            isHovered && "text-blue-500"
          )}
        />
      </div>
      <p className="line-clamp-3 text-sm leading-relaxed text-neutral-700">
        {citation.text}
      </p>
    </div>
  );
}

/**
 * Citation List — displays multiple citations
 */
interface CitationListProps {
  citations: Citation[];
  onNavigate?: (citation: Citation) => void;
  className?: string;
  maxVisible?: number;
}

export function CitationList({ citations, onNavigate, className, maxVisible = 3 }: CitationListProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleCitations = showAll ? citations : citations.slice(0, maxVisible);
  const hiddenCount = citations.length - maxVisible;

  if (citations.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {visibleCitations.map((citation, index) => (
        <CitationCard
          key={`${citation.cfi}-${index}`}
          citation={citation}
          onNavigate={onNavigate}
        />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full rounded-lg border border-dashed border-neutral-200 py-2 text-sm text-neutral-500 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
        >
          显示更多 {hiddenCount} 条引用
        </button>
      )}
    </div>
  );
}

/**
 * Inline Citation — inline reference with tooltip preview
 */
interface InlineCitationProps {
  text: string;
  chapterTitle: string;
  cfi: string;
  onNavigate?: (cfi: string) => void;
}

export function InlineCitation({ text, chapterTitle, cfi, onNavigate }: InlineCitationProps) {
  return (
    <span
      onClick={() => onNavigate?.(cfi)}
      className="group relative inline cursor-pointer"
    >
      <span className="rounded bg-blue-100 px-0.5 text-blue-700 transition-colors hover:bg-blue-200">
        {text}
      </span>
      <span className="pointer-events-none invisible absolute bottom-full left-0 z-50 mb-1 w-64 rounded bg-neutral-800 p-2 text-xs text-white opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
        <span className="block font-medium">{chapterTitle}</span>
        <span className="mt-1 line-clamp-2 block text-neutral-300">{text}</span>
      </span>
    </span>
  );
}
