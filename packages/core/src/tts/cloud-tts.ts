import { getPlatformService } from "../services/platform";
import { fetchEdgeTTSAudio } from "./edge-tts";
import {
  buildSynthesisCacheKey,
  getCachedSynthesisAudio,
  getOrCreateSynthesisAudio,
} from "./synthesis-cache";
import { DEFAULT_XIAOMI_TTS_BASE_URL, type TTSConfig, normalizeXiaomiTTSVoice } from "./types";

export const CLOUD_TTS_PCM_SAMPLE_RATE = 24000;
const DASHSCOPE_TTS_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const PRELOAD_CHUNK_LIMIT = 4;

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/u, "");
  const normalizedPath = path.replace(/^\/+/u, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function openAIHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function buildTTSHttpError(label: string, response: Response): Promise<Error> {
  let detail = "";
  try {
    detail = (await response.text()).trim();
  } catch {}
  const suffix = detail ? ` — ${detail.slice(0, 500)}` : "";
  return new Error(`${label} failed: ${response.status}${suffix}`);
}

export function isTTSAbortError(error: unknown): boolean {
  if (!error) return false;
  const maybeError = error as { name?: unknown; code?: unknown; message?: unknown };
  if (maybeError.name === "AbortError") return true;
  if (maybeError.code === "ERR_CANCELED" || maybeError.code === "ABORT_ERR") return true;
  const message = typeof maybeError.message === "string" ? maybeError.message : String(error);
  return /\b(aborted?|cancel(?:ed|led))\b/iu.test(message);
}

export function buildXiaomiTTSMessages(text: string, config: TTSConfig) {
  return [
    {
      role: "user",
      content: config.xiaomiStylePrompt || "自然、平稳、适合长时间听书。",
    },
    {
      role: "assistant",
      content: text,
    },
  ];
}

export function buildXiaomiTTSUrl(config: Pick<TTSConfig, "xiaomiBaseUrl">): string {
  return joinUrl(config.xiaomiBaseUrl || DEFAULT_XIAOMI_TTS_BASE_URL, "/chat/completions");
}

export function buildOpenAIChatTTSMessages(text: string, config: TTSConfig) {
  const stylePrompt = config.openaiTtsStylePrompt || "自然、平稳、适合长时间听书。";
  return [
    {
      role: "user",
      content: stylePrompt,
    },
    {
      role: "assistant",
      content: text,
    },
  ];
}

function credentialCachePartition(credential: string): string {
  let hash = 2166136261;
  for (let index = 0; index < credential.length; index++) {
    hash ^= credential.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${credential.length}:${(hash >>> 0).toString(16)}`;
}

function getSynthesisKey(text: string, config: TTSConfig): string | null {
  switch (config.engine) {
    case "edge": {
      const voice = config.edgeVoice || "zh-CN-XiaoxiaoNeural";
      const lang = voice.split("-").slice(0, 2).join("-");
      return buildSynthesisCacheKey("edge", text, [voice, lang, config.rate, config.pitch]);
    }
    case "dashscope":
      return buildSynthesisCacheKey("dashscope", text, [
        "qwen3-tts-flash",
        config.dashscopeVoice,
        "mp3",
        credentialCachePartition(config.dashscopeApiKey),
      ]);
    case "xiaomi":
      return buildSynthesisCacheKey("xiaomi", text, [
        config.xiaomiBaseUrl || DEFAULT_XIAOMI_TTS_BASE_URL,
        "mimo-v2.5-tts",
        normalizeXiaomiTTSVoice(config.xiaomiVoice),
        config.xiaomiStylePrompt,
        "wav",
        credentialCachePartition(config.xiaomiApiKey),
      ]);
    case "openai-compatible":
      return buildSynthesisCacheKey("openai-compatible", text, [
        config.openaiTtsBaseUrl,
        config.openaiTtsEndpoint,
        config.openaiTtsModel,
        config.openaiTtsVoice,
        config.openaiTtsFormat,
        config.openaiTtsStylePrompt,
        credentialCachePartition(config.openaiTtsApiKey),
      ]);
    case "system":
      return null;
  }
}

async function fetchXiaomiTTSWavUncached(text: string, config: TTSConfig): Promise<Uint8Array> {
  if (!config.xiaomiApiKey) throw new Error("Xiaomi MiMo API key is required");

  const platform = getPlatformService();
  const response = await platform.fetch(buildXiaomiTTSUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.xiaomiApiKey,
    },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      messages: buildXiaomiTTSMessages(text, config),
      audio: {
        format: "wav",
        voice: normalizeXiaomiTTSVoice(config.xiaomiVoice),
      },
    }),
  });

  if (!response.ok) {
    throw await buildTTSHttpError("Xiaomi MiMo TTS", response);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { audio?: { data?: string } } }>;
  };
  const audioData = result.choices?.[0]?.message?.audio?.data;
  if (!audioData) throw new Error("No audio data in Xiaomi MiMo response");
  return base64ToBytes(audioData);
}

export function fetchXiaomiTTSWav(text: string, config: TTSConfig): Promise<Uint8Array> {
  const key = getSynthesisKey(text, { ...config, engine: "xiaomi" });
  if (!key) throw new Error("Unable to cache Xiaomi MiMo TTS audio");
  return getOrCreateSynthesisAudio(key, () => fetchXiaomiTTSWavUncached(text, config));
}

async function fetchOpenAITTSAudioUncached(text: string, config: TTSConfig): Promise<Uint8Array> {
  if (!config.openaiTtsApiKey) throw new Error("OpenAI-compatible TTS API key is required");

  const platform = getPlatformService();
  if (config.openaiTtsEndpoint === "chat-completions") {
    const response = await platform.fetch(joinUrl(config.openaiTtsBaseUrl, "/chat/completions"), {
      method: "POST",
      headers: openAIHeaders(config.openaiTtsApiKey),
      body: JSON.stringify({
        model: config.openaiTtsModel,
        messages: buildOpenAIChatTTSMessages(text, config),
        audio: {
          format: config.openaiTtsFormat === "pcm16" ? "wav" : config.openaiTtsFormat,
          voice: config.openaiTtsVoice,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible chat TTS failed: ${response.status}`);
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { audio?: { data?: string } } }>;
    };
    const audioData = result.choices?.[0]?.message?.audio?.data;
    if (!audioData) throw new Error("No audio data in OpenAI-compatible chat TTS response");
    return base64ToBytes(audioData);
  }

  const response = await platform.fetch(joinUrl(config.openaiTtsBaseUrl, "/audio/speech"), {
    method: "POST",
    headers: openAIHeaders(config.openaiTtsApiKey),
    body: JSON.stringify({
      model: config.openaiTtsModel,
      input: text,
      voice: config.openaiTtsVoice,
      response_format: config.openaiTtsFormat,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible audio speech failed: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export function fetchOpenAITTSAudio(text: string, config: TTSConfig): Promise<Uint8Array> {
  const key = getSynthesisKey(text, { ...config, engine: "openai-compatible" });
  if (!key) throw new Error("Unable to cache OpenAI-compatible TTS audio");
  return getOrCreateSynthesisAudio(key, () => fetchOpenAITTSAudioUncached(text, config));
}

async function fetchDashScopeTTSAudioUncached(
  text: string,
  config: TTSConfig,
): Promise<Uint8Array> {
  if (!config.dashscopeApiKey) throw new Error("DashScope API key is required");

  const response = await getPlatformService().fetch(DASHSCOPE_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: "qwen3-tts-flash",
      input: { text, voice: config.dashscopeVoice },
      parameters: { response_format: "mp3" },
    }),
  });

  if (!response.ok) throw await buildTTSHttpError("DashScope TTS", response);
  const result = (await response.json()) as {
    output?: { audio?: { data?: string } };
  };
  const audioData = result.output?.audio?.data;
  if (!audioData) throw new Error("No audio data in DashScope response");
  return base64ToBytes(audioData);
}

export function fetchDashScopeTTSAudio(text: string, config: TTSConfig): Promise<Uint8Array> {
  const key = getSynthesisKey(text, { ...config, engine: "dashscope" });
  if (!key) throw new Error("Unable to cache DashScope TTS audio");
  return getOrCreateSynthesisAudio(key, () => fetchDashScopeTTSAudioUncached(text, config));
}

export function getPreloadedTTSAudio(text: string, config: TTSConfig): Promise<Uint8Array> | null {
  const key = getSynthesisKey(text, config);
  return key ? getCachedSynthesisAudio(key) : null;
}

async function synthesizeTTSAudio(text: string, config: TTSConfig): Promise<void> {
  switch (config.engine) {
    case "edge": {
      const voice = config.edgeVoice || "zh-CN-XiaoxiaoNeural";
      await fetchEdgeTTSAudio({
        text,
        voice,
        lang: voice.split("-").slice(0, 2).join("-"),
        rate: config.rate,
        pitch: config.pitch,
      });
      return;
    }
    case "dashscope":
      await fetchDashScopeTTSAudio(text, config);
      return;
    case "xiaomi":
      await fetchXiaomiTTSWav(text, config);
      return;
    case "openai-compatible":
      await fetchOpenAITTSAudio(text, config);
      return;
    case "system":
      return;
  }
}

export async function preloadTTSChunks(
  segments: string[],
  config: TTSConfig,
  limit = PRELOAD_CHUNK_LIMIT,
): Promise<void> {
  const candidates = segments
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, limit);
  await Promise.all(
    candidates.map(async (text) => {
      try {
        await synthesizeTTSAudio(text, config);
      } catch (error) {
        console.warn("[TTS] preload failed", {
          engine: config.engine,
          text: text.slice(0, 160),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}
