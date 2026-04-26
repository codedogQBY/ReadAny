// Types & constants
export type {
  ITTSPlayer,
  LegacyTTSEngine,
  PersistedTTSConfig,
  TTSEngine,
  TTSConfig,
  TTSPlayState,
} from "./types";
export { DEFAULT_TTS_CONFIG, DASHSCOPE_VOICES, MIMO_VOICES, normalizeTTSConfig, normalizeTTSEngine } from "./types";

// Text utilities
export { cleanText, countChars, splitIntoChunks } from "./text-utils";
export { buildNarrationPreview, getTTSVoiceLabel, splitNarrationText } from "./display";
export { compareVoiceLanguage, getLocaleDisplayLabel, groupEdgeTTSVoices } from "./voice-groups";

// Edge TTS
export { fetchEdgeTTSAudio, EDGE_TTS_VOICES } from "./edge-tts";
export type { EdgeTTSVoice, EdgeTTSPayload } from "./edge-tts";

// Players
export { BrowserTTSPlayer, DashScopeTTSPlayer, EdgeTTSPlayer, MiMoTTSPlayer } from "./tts-players";
