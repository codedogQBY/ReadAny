import { compareVoiceLanguage } from "@readany/core/tts";
import { getSystemVoices } from "./tts-service";

export const DEFAULT_SYSTEM_VOICE_VALUE = "__default__";

export interface SystemVoiceOption {
  id: string;
  label: string;
  lang: string;
  isDefault?: boolean;
}

function compareVoice(a: SystemVoiceOption, b: SystemVoiceOption) {
  if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
  return a.label.localeCompare(b.label) || a.lang.localeCompare(b.lang);
}

export function getSystemVoiceOptions(
  voices: SpeechSynthesisVoice[] = getSystemVoices(),
): SystemVoiceOption[] {
  const deduped = new Map<string, SystemVoiceOption>();
  for (const voice of voices) {
    const option = {
      id: voice.voiceURI || voice.name,
      label: voice.name,
      lang: voice.lang || "und",
      isDefault: voice.default,
    };
    const existing = deduped.get(option.id);
    if (!existing || (!existing.isDefault && option.isDefault)) {
      deduped.set(option.id, option);
    }
  }
  return Array.from(deduped.values()).sort(compareVoice);
}

export function groupSystemVoiceOptions(
  voices: SystemVoiceOption[],
): Array<[string, SystemVoiceOption[]]> {
  const grouped = new Map<string, SystemVoiceOption[]>();
  for (const voice of voices) {
    const bucket = grouped.get(voice.lang) || [];
    bucket.push(voice);
    grouped.set(voice.lang, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => compareVoiceLanguage(a, b))
    .map(([lang, items]) => [lang, [...items].sort(compareVoice)] as [string, SystemVoiceOption[]]);
}

export function resolveSystemVoiceValue(
  selectedVoice: string | null | undefined,
  voices: SystemVoiceOption[],
): string {
  if (!selectedVoice) return DEFAULT_SYSTEM_VOICE_VALUE;
  const match = voices.find((voice) => voice.id === selectedVoice || voice.label === selectedVoice);
  return match?.id || DEFAULT_SYSTEM_VOICE_VALUE;
}

export function findSystemVoiceLabel(
  selectedVoice: string | null | undefined,
  voices: SystemVoiceOption[],
): string {
  if (!selectedVoice) return "";
  return (
    voices.find((voice) => voice.id === selectedVoice || voice.label === selectedVoice)?.label || ""
  );
}
