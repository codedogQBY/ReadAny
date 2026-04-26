import { EDGE_TTS_VOICES } from "./edge-tts";
import { DASHSCOPE_VOICES, MIMO_VOICES, type TTSConfig } from "./types";

const MAX_EXCERPT_LENGTH = 96;
const MAX_PREVIEW_LENGTH = 72;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function chunkText(text: string, chunkLength: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + chunkLength).trim());
    offset += chunkLength;
  }
  return chunks.filter(Boolean);
}

export function splitNarrationText(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentenceLikeParts = normalized
    .split(/(?<=[。！？!?；;…])|(?<=\.)\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceLikeParts.length > 1) {
    return sentenceLikeParts;
  }

  const commaParts = normalized
    .split(/(?<=[，,、])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length > 1) {
    return commaParts;
  }

  return chunkText(normalized, MAX_EXCERPT_LENGTH);
}

export function buildNarrationPreview(text: string): {
  currentExcerpt: string;
  nextExcerpt: string;
  supportingExcerpt: string;
} {
  const segments = splitNarrationText(text);
  const current = segments[0] || "";
  const next = segments[1] || "";
  const supporting = segments.slice(2).join(" ");

  return {
    currentExcerpt: truncateText(current || text.trim(), MAX_EXCERPT_LENGTH),
    nextExcerpt: truncateText(next || supporting || text.trim(), MAX_PREVIEW_LENGTH),
    supportingExcerpt: truncateText(supporting || next || text.trim(), MAX_EXCERPT_LENGTH),
  };
}

export function getTTSVoiceLabel(config: TTSConfig): string {
  if (config.engine === "edge") {
    const voice = EDGE_TTS_VOICES.find((item) => item.id === config.edgeVoice);
    return voice?.name || config.edgeVoice.replace(/Neural$/u, "");
  }

  if (config.engine === "dashscope") {
    const voice = DASHSCOPE_VOICES.find((item) => item.id === config.dashscopeVoice);
    return voice?.label || config.dashscopeVoice;
  }

  if (config.engine === "mimo") {
    const voice = MIMO_VOICES.find((item) => item.id === config.mimoVoice);
    return voice?.label || config.mimoVoice;
  }

  return config.systemVoiceLabel || config.voiceName || "System Voice";
}
