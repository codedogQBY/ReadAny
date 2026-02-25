/**
 * Semantic Reading Context (SRC) — generates context based on reader state
 */
import type { SemanticContext } from "@/types";

export type OperationType = "reading" | "highlighting" | "searching" | "navigating";

interface ReaderSnapshot {
  chapterTitle: string;
  currentCfi: string;
  visibleText: string;
  selectedText?: string;
  recentHighlights: string[];
}

/** Generate semantic context from current reader state */
export function generateSemanticContext(
  snapshot: ReaderSnapshot,
  operationType: OperationType,
): SemanticContext {
  return {
    currentChapter: snapshot.chapterTitle,
    currentPosition: snapshot.currentCfi,
    surroundingText: truncateText(snapshot.visibleText, 500),
    recentHighlights: snapshot.recentHighlights.slice(0, 5),
    operationType,
  };
}

/** Detect operation type from user actions */
export function detectOperationType(action: {
  hasSelection: boolean;
  isSearching: boolean;
  isNavigating: boolean;
}): OperationType {
  if (action.hasSelection) return "highlighting";
  if (action.isSearching) return "searching";
  if (action.isNavigating) return "navigating";
  return "reading";
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
