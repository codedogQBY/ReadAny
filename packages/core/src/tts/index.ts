// Types & constants
export type {
  ITTSPlayer,
  LegacyTTSEngine,
  OpenAITTSEndpoint,
  PersistedTTSConfig,
  TTSAudioFormat,
  TTSEngine,
  TTSConfig,
  TTSPlayState,
  TTSProfile,
  TTSProviderDefinition,
  TTSProviderType,
} from "./types";
export {
  createDefaultTTSProfiles,
  DEFAULT_TTS_CONFIG,
  DEFAULT_XIAOMI_STYLE_PROMPT,
  DEFAULT_XIAOMI_TTS_BASE_URL,
  DEFAULT_XIAOMI_TTS_VOICE,
  DASHSCOPE_VOICES,
  getActiveTTSProfile,
  getTTSProviderDefinition,
  normalizeTTSConfig,
  normalizeTTSEngine,
  normalizeXiaomiTTSVoice,
  syncConfigFromActiveProfile,
  TTS_PROVIDER_DEFINITIONS,
  XIAOMI_TTS_VOICES,
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
export { SegmentPlanner } from "./segment-planner";
export type { Segment, SegmentPosition, SegmentPlannerOptions } from "./segment-planner";
export {
  LegacyPlayerProvider,
  TTSCoordinator,
  normalizeTTSError,
} from "./coordinator";
export type {
  TTSCoordinatorCallbacks,
  TTSCoordinatorError,
  TTSCoordinatorState,
  TTSCoordinatorStatus,
} from "./coordinator";

// Edge TTS
export { fetchEdgeTTSAudio, EDGE_TTS_VOICES } from "./edge-tts";
export type { EdgeTTSVoice, EdgeTTSPayload } from "./edge-tts";

// Players
export {
  BrowserTTSPlayer,
  DashScopeTTSPlayer,
  EdgeTTSPlayer,
  OpenAICompatibleTTSPlayer,
  XiaomiTTSPlayer,
} from "./tts-players";
export {
  base64ToBytes,
  buildOpenAIChatTTSMessages,
  buildXiaomiTTSUrl,
  buildXiaomiTTSMessages,
  fetchOpenAITTSAudio,
  fetchXiaomiTTSWav,
  isTTSAbortError,
} from "./cloud-tts";

// Re-speak on synthesis-param change (#370)
export {
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  shouldRespeakForSynthChange,
} from "./respeak";
