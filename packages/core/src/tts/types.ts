/**
 * TTS types and constants — shared across all platforms.
 */

export type TTSEngine = "system" | "edge" | "dashscope" | "xiaomi" | "openai-compatible";
export type LegacyTTSEngine = TTSEngine | "browser";
export type TTSProviderType = TTSEngine;
export type TTSAudioFormat = "pcm16" | "wav" | "mp3";
export type OpenAITTSEndpoint = "audio-speech" | "chat-completions";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSConfig {
  engine: TTSEngine;
  /** Active saved voice profile. Falls back to engine when absent. */
  activeProfileId: string;
  /** System voice identifier (or legacy display name on older configs) */
  voiceName: string;
  /** Human-readable system voice label for UI display */
  systemVoiceLabel: string;
  /** Speech rate (0.5 - 2.0) */
  rate: number;
  /** Speech pitch (0.5 - 2.0) */
  pitch: number;
  /** Edge TTS voice ID (e.g. "zh-CN-XiaoxiaoNeural") */
  edgeVoice: string;
  /** DashScope API Key (optional, for high-quality TTS) */
  dashscopeApiKey: string;
  /** DashScope voice (e.g. "Cherry", "Ethan") */
  dashscopeVoice: string;
  /** Xiaomi MiMo API Key */
  xiaomiApiKey: string;
  /** Xiaomi MiMo TTS base URL */
  xiaomiBaseUrl: string;
  /** Xiaomi MiMo TTS voice (e.g. "mimo_default", "冰糖", "Chloe") */
  xiaomiVoice: string;
  /** Natural-language style instruction for Xiaomi MiMo TTS */
  xiaomiStylePrompt: string;
  /** OpenAI-compatible TTS base URL */
  openaiTtsBaseUrl: string;
  /** OpenAI-compatible TTS API Key */
  openaiTtsApiKey: string;
  /** OpenAI-compatible TTS endpoint shape */
  openaiTtsEndpoint: OpenAITTSEndpoint;
  /** OpenAI-compatible TTS model */
  openaiTtsModel: string;
  /** OpenAI-compatible TTS voice */
  openaiTtsVoice: string;
  /** OpenAI-compatible TTS audio format */
  openaiTtsFormat: TTSAudioFormat;
  /** Optional style/system prompt for chat-completions audio providers */
  openaiTtsStylePrompt: string;
  /** Saved voice profiles for scalable provider UI. */
  profiles: TTSProfile[];
}

export interface TTSProviderDefinition {
  id: TTSProviderType;
  label: string;
  description: string;
  category: "built-in" | "cloud" | "custom";
  requiresApiKey: boolean;
  supportsVoice: boolean;
  supportsStylePrompt: boolean;
  supportsBaseUrl: boolean;
  supportsStreaming: boolean;
}

export interface TTSProfile {
  id: string;
  name: string;
  provider: TTSProviderType;
  baseUrl?: string;
  apiKey?: string;
  endpoint?: OpenAITTSEndpoint;
  model?: string;
  voice?: string;
  format?: TTSAudioFormat;
  stylePrompt?: string;
}

export const TTS_PROVIDER_DEFINITIONS: TTSProviderDefinition[] = [
  {
    id: "edge",
    label: "Edge TTS",
    description: "Microsoft neural voices, no API key required.",
    category: "built-in",
    requiresApiKey: false,
    supportsVoice: true,
    supportsStylePrompt: false,
    supportsBaseUrl: false,
    supportsStreaming: false,
  },
  {
    id: "system",
    label: "System Voice",
    description: "Use voices installed on this device.",
    category: "built-in",
    requiresApiKey: false,
    supportsVoice: true,
    supportsStylePrompt: false,
    supportsBaseUrl: false,
    supportsStreaming: false,
  },
  {
    id: "dashscope",
    label: "DashScope",
    description: "Alibaba Cloud qwen3-tts-flash.",
    category: "cloud",
    requiresApiKey: true,
    supportsVoice: true,
    supportsStylePrompt: false,
    supportsBaseUrl: false,
    supportsStreaming: true,
  },
  {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    description: "MiMo-V2.5-TTS with voice and style control.",
    category: "cloud",
    requiresApiKey: true,
    supportsVoice: true,
    supportsStylePrompt: true,
    supportsBaseUrl: true,
    supportsStreaming: true,
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    description: "Custom OpenAI audio/speech or chat audio endpoint.",
    category: "custom",
    requiresApiKey: true,
    supportsVoice: true,
    supportsStylePrompt: true,
    supportsBaseUrl: true,
    supportsStreaming: true,
  },
] as const;

export const XIAOMI_TTS_VOICES = [
  { id: "mimo_default", label: "MiMo 默认" },
  { id: "冰糖", label: "冰糖 · 中文女声" },
  { id: "茉莉", label: "茉莉 · 中文女声" },
  { id: "苏打", label: "苏打 · 中文男声" },
  { id: "白桦", label: "白桦 · 中文男声" },
  { id: "Mia", label: "Mia · English female" },
  { id: "Chloe", label: "Chloe" },
  { id: "Milo", label: "Milo · English male" },
  { id: "Dean", label: "Dean" },
] as const;

export const DEFAULT_XIAOMI_TTS_VOICE = "mimo_default";
export const DEFAULT_XIAOMI_TTS_BASE_URL = "https://api.xiaomimimo.com/v1";
export const DEFAULT_XIAOMI_STYLE_PROMPT = "自然、平稳、适合长时间听书。";

export function normalizeXiaomiTTSVoice(voice: string | null | undefined): string {
  if (voice && XIAOMI_TTS_VOICES.some((item) => item.id === voice)) return voice;
  return DEFAULT_XIAOMI_TTS_VOICE;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: "edge",
  activeProfileId: "edge-default",
  voiceName: "",
  systemVoiceLabel: "",
  rate: 1.0,
  pitch: 1.0,
  edgeVoice: "zh-CN-XiaoxiaoNeural",
  dashscopeApiKey: "",
  dashscopeVoice: "Cherry",
  xiaomiApiKey: "",
  xiaomiBaseUrl: DEFAULT_XIAOMI_TTS_BASE_URL,
  xiaomiVoice: DEFAULT_XIAOMI_TTS_VOICE,
  xiaomiStylePrompt: DEFAULT_XIAOMI_STYLE_PROMPT,
  openaiTtsBaseUrl: "https://api.openai.com/v1",
  openaiTtsApiKey: "",
  openaiTtsEndpoint: "audio-speech",
  openaiTtsModel: "gpt-4o-mini-tts",
  openaiTtsVoice: "alloy",
  openaiTtsFormat: "mp3",
  openaiTtsStylePrompt: DEFAULT_XIAOMI_STYLE_PROMPT,
  profiles: [],
};

export interface PersistedTTSConfig extends Partial<Omit<TTSConfig, "engine">> {
  engine?: LegacyTTSEngine | string | null;
}

export function normalizeTTSEngine(engine: LegacyTTSEngine | string | null | undefined): TTSEngine {
  if (
    engine === "system" ||
    engine === "edge" ||
    engine === "dashscope" ||
    engine === "xiaomi" ||
    engine === "openai-compatible"
  ) {
    return engine;
  }
  if (engine === "browser") {
    return "system";
  }
  return DEFAULT_TTS_CONFIG.engine;
}

export function getTTSProviderDefinition(provider: TTSProviderType): TTSProviderDefinition {
  return (
    TTS_PROVIDER_DEFINITIONS.find((item) => item.id === provider) ?? TTS_PROVIDER_DEFINITIONS[0]
  );
}

export function createDefaultTTSProfiles(config: Partial<TTSConfig> = {}): TTSProfile[] {
  return [
    {
      id: "edge-default",
      name: "Edge TTS",
      provider: "edge",
      voice: config.edgeVoice ?? DEFAULT_TTS_CONFIG.edgeVoice,
    },
    {
      id: "system-default",
      name: "System Voice",
      provider: "system",
      voice: config.voiceName ?? DEFAULT_TTS_CONFIG.voiceName,
    },
    {
      id: "dashscope-default",
      name: "DashScope",
      provider: "dashscope",
      apiKey: config.dashscopeApiKey ?? "",
      voice: config.dashscopeVoice ?? DEFAULT_TTS_CONFIG.dashscopeVoice,
      model: "qwen3-tts-flash",
      format: "mp3",
    },
    {
      id: "xiaomi-mimo-default",
      name: "Xiaomi MiMo",
      provider: "xiaomi",
      baseUrl: config.xiaomiBaseUrl ?? DEFAULT_TTS_CONFIG.xiaomiBaseUrl,
      apiKey: config.xiaomiApiKey ?? "",
      voice: normalizeXiaomiTTSVoice(config.xiaomiVoice ?? DEFAULT_TTS_CONFIG.xiaomiVoice),
      model: "mimo-v2.5-tts",
      format: "pcm16",
      stylePrompt: config.xiaomiStylePrompt ?? DEFAULT_XIAOMI_STYLE_PROMPT,
    },
    {
      id: "openai-compatible-default",
      name: "OpenAI Compatible",
      provider: "openai-compatible",
      baseUrl: config.openaiTtsBaseUrl ?? DEFAULT_TTS_CONFIG.openaiTtsBaseUrl,
      apiKey: config.openaiTtsApiKey ?? "",
      endpoint: config.openaiTtsEndpoint ?? DEFAULT_TTS_CONFIG.openaiTtsEndpoint,
      model: config.openaiTtsModel ?? DEFAULT_TTS_CONFIG.openaiTtsModel,
      voice: config.openaiTtsVoice ?? DEFAULT_TTS_CONFIG.openaiTtsVoice,
      format: config.openaiTtsFormat ?? DEFAULT_TTS_CONFIG.openaiTtsFormat,
      stylePrompt: config.openaiTtsStylePrompt ?? DEFAULT_XIAOMI_STYLE_PROMPT,
    },
  ];
}

export function getActiveTTSProfile(config: TTSConfig): TTSProfile {
  return (
    config.profiles.find((profile) => profile.id === config.activeProfileId) ??
    config.profiles.find((profile) => profile.provider === config.engine) ??
    createDefaultTTSProfiles(config).find((profile) => profile.provider === config.engine) ??
    createDefaultTTSProfiles(config)[0]
  );
}

function normalizeProfiles(config: Partial<TTSConfig>): TTSProfile[] {
  const defaults = createDefaultTTSProfiles(config);
  const persisted = Array.isArray(config.profiles) ? config.profiles : [];
  const defaultIds = new Set(defaults.map((profile) => profile.id));
  const merged = new Map<string, TTSProfile>();
  for (const profile of defaults) {
    merged.set(profile.id, profile);
  }
  for (const profile of persisted) {
    if (!profile?.id || !profile.provider) continue;
    const normalizedProfile: TTSProfile =
      profile.provider === "xiaomi"
        ? { ...profile, voice: normalizeXiaomiTTSVoice(profile.voice) }
        : profile;
    const fallback = merged.get(profile.id);
    merged.set(profile.id, fallback ? { ...fallback, ...normalizedProfile } : normalizedProfile);
  }
  return Array.from(merged.values()).filter((profile) => {
    if (defaultIds.has(profile.id)) return true;
    return !!profile.name && !!profile.provider;
  });
}

export function syncConfigFromActiveProfile(config: TTSConfig): TTSConfig {
  const activeProfile = getActiveTTSProfile(config);
  const engine = activeProfile.provider;
  const next: TTSConfig = {
    ...config,
    engine,
    activeProfileId: activeProfile.id,
  };

  if (engine === "edge" && activeProfile.voice) {
    next.edgeVoice = activeProfile.voice;
  } else if (engine === "system") {
    next.voiceName = activeProfile.voice ?? "";
  } else if (engine === "dashscope") {
    next.dashscopeApiKey = activeProfile.apiKey ?? next.dashscopeApiKey;
    next.dashscopeVoice = activeProfile.voice ?? next.dashscopeVoice;
  } else if (engine === "xiaomi") {
    next.xiaomiBaseUrl = activeProfile.baseUrl ?? next.xiaomiBaseUrl;
    next.xiaomiApiKey = activeProfile.apiKey ?? next.xiaomiApiKey;
    next.xiaomiVoice = normalizeXiaomiTTSVoice(activeProfile.voice ?? next.xiaomiVoice);
    next.xiaomiStylePrompt = activeProfile.stylePrompt ?? next.xiaomiStylePrompt;
  } else if (engine === "openai-compatible") {
    next.openaiTtsBaseUrl = activeProfile.baseUrl ?? next.openaiTtsBaseUrl;
    next.openaiTtsApiKey = activeProfile.apiKey ?? next.openaiTtsApiKey;
    next.openaiTtsEndpoint = activeProfile.endpoint ?? next.openaiTtsEndpoint;
    next.openaiTtsModel = activeProfile.model ?? next.openaiTtsModel;
    next.openaiTtsVoice = activeProfile.voice ?? next.openaiTtsVoice;
    next.openaiTtsFormat = activeProfile.format ?? next.openaiTtsFormat;
    next.openaiTtsStylePrompt = activeProfile.stylePrompt ?? next.openaiTtsStylePrompt;
  }

  return next;
}

export function normalizeTTSConfig(config: PersistedTTSConfig | null | undefined): TTSConfig {
  const hasExplicitProfileId =
    typeof config?.activeProfileId === "string" && config.activeProfileId.length > 0;
  const normalizedEngine = normalizeTTSEngine(config?.engine);
  const profileSource: Partial<TTSConfig> = {
    ...config,
    engine: normalizedEngine,
  };
  const normalized: TTSConfig = {
    ...DEFAULT_TTS_CONFIG,
    ...config,
    engine: normalizedEngine,
    activeProfileId: hasExplicitProfileId ? (config.activeProfileId ?? "") : "",
    voiceName: config?.voiceName ?? DEFAULT_TTS_CONFIG.voiceName,
    systemVoiceLabel: config?.systemVoiceLabel ?? DEFAULT_TTS_CONFIG.systemVoiceLabel,
    rate: typeof config?.rate === "number" ? config.rate : DEFAULT_TTS_CONFIG.rate,
    pitch: typeof config?.pitch === "number" ? config.pitch : DEFAULT_TTS_CONFIG.pitch,
    edgeVoice: config?.edgeVoice ?? DEFAULT_TTS_CONFIG.edgeVoice,
    dashscopeApiKey: config?.dashscopeApiKey ?? DEFAULT_TTS_CONFIG.dashscopeApiKey,
    dashscopeVoice: config?.dashscopeVoice ?? DEFAULT_TTS_CONFIG.dashscopeVoice,
    xiaomiApiKey: config?.xiaomiApiKey ?? DEFAULT_TTS_CONFIG.xiaomiApiKey,
    xiaomiBaseUrl: config?.xiaomiBaseUrl ?? DEFAULT_TTS_CONFIG.xiaomiBaseUrl,
    xiaomiVoice: normalizeXiaomiTTSVoice(config?.xiaomiVoice ?? DEFAULT_TTS_CONFIG.xiaomiVoice),
    xiaomiStylePrompt: config?.xiaomiStylePrompt ?? DEFAULT_TTS_CONFIG.xiaomiStylePrompt,
    openaiTtsBaseUrl: config?.openaiTtsBaseUrl ?? DEFAULT_TTS_CONFIG.openaiTtsBaseUrl,
    openaiTtsApiKey: config?.openaiTtsApiKey ?? DEFAULT_TTS_CONFIG.openaiTtsApiKey,
    openaiTtsEndpoint: config?.openaiTtsEndpoint ?? DEFAULT_TTS_CONFIG.openaiTtsEndpoint,
    openaiTtsModel: config?.openaiTtsModel ?? DEFAULT_TTS_CONFIG.openaiTtsModel,
    openaiTtsVoice: config?.openaiTtsVoice ?? DEFAULT_TTS_CONFIG.openaiTtsVoice,
    openaiTtsFormat: config?.openaiTtsFormat ?? DEFAULT_TTS_CONFIG.openaiTtsFormat,
    openaiTtsStylePrompt: config?.openaiTtsStylePrompt ?? DEFAULT_TTS_CONFIG.openaiTtsStylePrompt,
    profiles: normalizeProfiles(profileSource),
  };

  if (
    !hasExplicitProfileId ||
    !normalized.profiles.some((profile) => profile.id === normalized.activeProfileId) ||
    normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)?.provider !==
      normalized.engine
  ) {
    normalized.activeProfileId =
      normalized.profiles.find((profile) => profile.provider === normalized.engine)?.id ??
      DEFAULT_TTS_CONFIG.activeProfileId;
  }

  return syncConfigFromActiveProfile(normalized);
}

export const DASHSCOPE_VOICES = [
  { id: "Cherry", label: "芊悦 (Cherry)" },
  { id: "Ethan", label: "晨煦 (Ethan)" },
  { id: "Nofish", label: "不吃鱼 (Nofish)" },
  { id: "Ryan", label: "甜茶 (Ryan)" },
  { id: "Katerina", label: "卡捷琳娜 (Katerina)" },
  { id: "Dylan", label: "北京-晓东 (Dylan)" },
  { id: "Sunny", label: "四川-晴儿 (Sunny)" },
  { id: "Peter", label: "天津-李彼得 (Peter)" },
  { id: "Rocky", label: "粤语-阿强 (Rocky)" },
  { id: "Kiki", label: "粤语-阿清 (Kiki)" },
] as const;

/**
 * ITTSPlayer — unified interface for all TTS engines.
 * Eliminates engine-specific if/else branching in store code.
 */
export interface ITTSPlayer {
  speak(text: string | string[], config: TTSConfig): void | Promise<void>;
  append?(text: string | string[]): void | Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Whether playback is currently paused (true suspend). Optional — platforms without true pause may omit it. */
  readonly paused?: boolean;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  /** Called when playback cannot continue. Must not be followed by onEnd. */
  onError?: (error: Error) => void;
  /** Called when all chunks finish playing naturally (not by stop()) */
  onEnd?: () => void;
}
