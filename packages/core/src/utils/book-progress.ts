export function normalizeBookProgress(progress: unknown): number {
  const value = typeof progress === "number" ? progress : Number(progress);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function getBookProgressPercent(progress: unknown): number {
  return Math.round(normalizeBookProgress(progress) * 100);
}
