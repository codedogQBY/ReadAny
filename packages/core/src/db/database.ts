/**
 * Database access layer — re-exports from domain-specific modules.
 *
 * This file exists for backward compatibility: external modules that
 * `import { … } from "./database"` will continue to work unchanged.
 *
 * New code should import from the specific query module or from the
 * barrel `./index` (equivalently `../db`).
 */

// --- Core infrastructure ---
export {
  getActiveDataRoot,
  getDatabaseFilePath,
  cleanupOrphanedSyncRows,
  getDB,
  getLocalDB,
  closeDB,
  closeLocalDB,
  ensureNoTransaction,
  resetDBCache,
  resetLocalDBCache,
  getDeviceId,
  initDatabase,
  initLocalDatabase,
  // Shared utilities
  nextSyncVersion,
  nextUpdatedAt,
  insertTombstone,
  parseJSON,
  serializeEmbedding,
  deserializeEmbedding,
} from "./db-core";

// --- Domain queries ---
export {
  getBooks,
  getBook,
  getDeletedBookByFileHash,
  getDeletedBookByTitle,
  insertBook,
  updateBook,
  setBookSyncStatus,
  deleteBook,
} from "./book-queries";

export {
  getGroups,
  insertGroup,
  updateGroup,
  deleteGroup,
} from "./group-queries";

export {
  getHighlights,
  getAllHighlights,
  getAllHighlightsWithBooks,
  getHighlightStats,
  insertHighlight,
  updateHighlight,
  deleteHighlight,
} from "./highlight-queries";
export type { HighlightWithBook } from "./highlight-queries";

export {
  getNotes,
  getAllNotes,
  insertNote,
  updateNote,
  deleteNote,
} from "./note-queries";

export {
  getBookmarks,
  insertBookmark,
  deleteBookmark,
} from "./bookmark-queries";

export {
  getThreads,
  getThread,
  insertThread,
  updateThreadTitle,
  deleteThread,
  deleteThreadsByBookId,
} from "./thread-queries";

export {
  getMessages,
  insertMessage,
} from "./message-queries";

export {
  getAllReadingSessions,
  getReadingSessions,
  getReadingSessionsByDateRange,
  insertReadingSession,
  updateReadingSession,
} from "./session-queries";

export {
  getChunks,
  insertChunks,
  deleteChunks,
  clearVectorizationFlagsWithoutLocalChunks,
} from "./chunk-queries";

export {
  getSkills,
  insertSkill,
  upsertSkill,
  updateSkill,
  deleteSkill,
} from "./skill-queries";
