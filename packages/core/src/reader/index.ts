// Font themes
export { FONT_THEMES, DEFAULT_FONT_THEME, getFontTheme } from "./font-themes";

// Keyboard shortcuts
export { DEFAULT_BINDINGS, isInputElement, matchBinding, findAction } from "./keyboard";
export type { KeyBinding } from "./keyboard";

// Pagination
export {
  getPageDirection,
  getScrollPageOffset,
  navigatePage,
  calculateProgress,
} from "./pagination";
export type { PageDirection } from "./pagination";

// Progress tracking
export { createProgressTracker, estimateTimeToFinish } from "./progress";
export type { ProgressData } from "./progress";

// Session detection
export { createSessionDetector } from "./session-detector";
export type { SessionEvent, SessionDetector } from "./session-detector";

// Annotation mutations
export { createSelectionNoteMutation } from "./selection-note";
export type { SelectionNoteMutation, SelectionNoteMutationInput } from "./selection-note";

// TTS
export { splitTextIntoTTSSegmentRanges } from "./tts-segments";
export type { TTSTextSegmentRange } from "./tts-segments";
