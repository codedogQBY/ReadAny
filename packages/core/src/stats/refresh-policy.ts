const STATS_RELEVANT_BOOK_UPDATE_FIELDS = new Set(["meta", "tags", "groupId", "deletedAt"]);

export function isStatsRelevantBookUpdate(changedFields?: readonly string[]): boolean {
  if (!changedFields || changedFields.length === 0) return true;
  return changedFields.some((field) => STATS_RELEVANT_BOOK_UPDATE_FIELDS.has(field));
}
