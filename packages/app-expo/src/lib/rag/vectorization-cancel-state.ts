const CANCELLABLE_STATUSES = new Set([
  "loading",
  "extracting",
  "chunking",
  "vectorizing",
  "embedding",
  "indexing",
]);

export function isVectorizationCancellable(isActive: boolean, status?: string): boolean {
  return isActive && (status === undefined || CANCELLABLE_STATUSES.has(status));
}
