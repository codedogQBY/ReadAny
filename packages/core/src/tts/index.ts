// Types & constants
export type {
  ITTSPlayer,
  LegacyTTSEngine,
  PersistedTTSConfig,
  TTSEngine,
  TTSConfig,
  TTSPlayState,
} from "./types";
export {
  DEFAULT_TTS_CONFIG,
  DASHSCOPE_VOICES,
  normalizeTTSConfig,
  normalizeTTSEngine,
} from "./types";

// Text utilities
export {
  cleanText,
  countChars,
  isTTSFootnoteMarker,
  shouldSkipTTSNode,
  splitIntoChunks,
} from "./text-utils";
export { buildNarrationPreview, getTTSVoiceLabel, splitNarrationText } from "./display";
export { compareVoiceLanguage, getLocaleDisplayLabel, groupEdgeTTSVoices } from "./voice-groups";

// Edge TTS
export { fetchEdgeTTSAudio, EDGE_TTS_VOICES } from "./edge-tts";
export type { EdgeTTSVoice, EdgeTTSPayload } from "./edge-tts";

// Players
export { BrowserTTSPlayer, DashScopeTTSPlayer, EdgeTTSPlayer } from "./tts-players";

// Re-speak on synthesis-param change (#370)
export {
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  shouldRespeakForSynthChange,
} from "./respeak";
