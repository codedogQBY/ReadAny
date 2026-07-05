/**
 * @readany/core stores — re-export all stores
 */

// Persistence utilities
export { debouncedSave, loadFromFS, flushAllWrites, withPersist } from "./persist";

// Pure stores (no persistence)
export { useAppStore } from "./app-store";
export type { Tab, TabType, SidebarTab, SettingsTab, AppState } from "./app-store";

export { useChatReaderStore } from "./chat-reader-store";
export type { ChatReaderContext, ChatReaderState } from "./chat-reader-store";

export { useNotebookStore } from "./notebook-store";
export type { PendingNote, NotebookState } from "./notebook-store";

export { useReaderStore } from "./reader-store";
export type { NavigationHistoryItem, ReaderTab, ReaderState } from "./reader-store";

// Font store
export {
  useFontStore,
  generateFontId,
  createCustomFontFamily,
  getFontFormat,
  saveFontFile,
  deleteFontFile,
  getCSSFontFace,
  getRemoteCssImports,
  getFontFamilyCSS,
  getFontsDir,
} from "./font-store";
export type { FontState } from "./font-store";

// Persisted stores (FS JSON)
export { useSettingsStore } from "./settings-store";
export type { SettingsState } from "./settings-store";

export { useVectorModelStore } from "./vector-model-store";
export type { BuiltinModelStatus, BuiltinModelState, VectorModelState } from "./vector-model-store";

export { useTTSStore, setTTSPlayerFactories } from "./tts-store";
export type { TTSPlayState, TTSState, TTSPlayerFactories } from "./tts-store";

// DB stores (SQLite)
export { useAnnotationStore } from "./annotation-store";
export type { HighlightStats, AnnotationState } from "./annotation-store";

export { useChatStore } from "./chat-store";
export type { ChatState } from "./chat-store";

export { useReadingSessionStore } from "./reading-session-store";
export type { ReadingSessionState } from "./reading-session-store";

// Sync store
export { useSyncStore } from "./sync-store";
export type { SyncState } from "./sync-store";

// Goals store
export { useGoalsStore } from "./goals-store";
export type { GoalsState } from "./goals-store";
