/**
 * Pagination algorithm — click zone (37.5% / 25% / 37.5%) + scroll
 */

export type PageDirection = "prev" | "next" | "none";

interface ClickZoneConfig {
  prevRatio: number; // default 0.375
  neutralRatio: number; // default 0.25
  nextRatio: number; // default 0.375
}

const DEFAULT_ZONES: ClickZoneConfig = {
  prevRatio: 0.375,
  neutralRatio: 0.25,
  nextRatio: 0.375,
};

/** Determine page direction from click position */
export function getPageDirection(
  clickX: number,
  containerWidth: number,
  config: ClickZoneConfig = DEFAULT_ZONES,
): PageDirection {
  const ratio = clickX / containerWidth;
  if (ratio < config.prevRatio) return "prev";
  if (ratio > 1 - config.nextRatio) return "next";
  return "none";
}

/** Calculate page offset for scroll-based pagination */
export function getScrollPageOffset(containerHeight: number, overlapRatio = 0.1): number {
  return containerHeight * (1 - overlapRatio);
}

/** Navigate to next/prev page */
export function navigatePage(
  direction: PageDirection,
  currentPage: number,
  totalPages: number,
): number {
  if (direction === "prev") return Math.max(0, currentPage - 1);
  if (direction === "next") return Math.min(totalPages - 1, currentPage + 1);
  return currentPage;
}

/** Calculate reading progress from page position */
export function calculateProgress(currentPage: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.min(1, (currentPage + 1) / totalPages);
}
