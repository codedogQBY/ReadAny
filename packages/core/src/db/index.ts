export {
  initDatabase,
  initLocalDatabase,
  getDB,
  getLocalDB,
  closeDB,
  closeLocalDB,
  resetDBCache,
  resetLocalDBCache,
  getActiveDataRoot,
  getDatabaseFilePath,
  cleanupOrphanedSyncRows,
  ensureNoTransaction,
  getDeviceId,
  // Sync tracking utilities
  nextSyncVersion,
  nextUpdatedAt,
  insertTombstone,
  // Shared utilities
  parseJSON,
  serializeEmbedding,
  deserializeEmbedding,
  // Book queries
  getBooks,
  getBook,
  getDeletedBookByFileHash,
  insertBook,
  updateBook,
  setBookSyncStatus,
  deleteBook,
  // Group queries
  getGroups,
  insertGroup,
  updateGroup,
  deleteGroup,
  // Highlight queries
  getHighlights,
  getAllHighlights,
  getAllHighlightsWithBooks,
  getHighlightStats,
  insertHighlight,
  updateHighlight,
  deleteHighlight,
  // Note queries
  getNotes,
  getAllNotes,
  insertNote,
  updateNote,
  deleteNote,
  // Bookmark queries
  getBookmarks,
  insertBookmark,
  deleteBookmark,
  // Thread queries
  getThreads,
  getThread,
  insertThread,
  updateThreadTitle,
  deleteThread,
  deleteThreadsByBookId,
  // Message queries
  getMessages,
  insertMessage,
  // Reading session queries
  getAllReadingSessions,
  getReadingSessions,
  getReadingSessionsByDateRange,
  insertReadingSession,
  updateReadingSession,
  // Chunk queries
  getChunks,
  insertChunks,
  deleteChunks,
  clearVectorizationFlagsWithoutLocalChunks,
  // Skill queries
  getSkills,
  insertSkill,
  upsertSkill,
  updateSkill,
  deleteSkill,
} from "./database";

export type { HighlightWithBook } from "./database";
