import SystemTtsSynthesis, {
  isSystemTtsSynthesisAvailable,
} from "../../../modules/system-tts-synthesis";

export function canUseSystemTtsSynthesis(): boolean {
  return isSystemTtsSynthesisAvailable();
}

export async function synthesizeSystemTtsToFile(
  text: string,
  options: {
    rate?: number;
    pitch?: number;
    language?: string;
    voice?: string;
  },
): Promise<string> {
  if (!canUseSystemTtsSynthesis()) {
    throw new Error("System TTS synthesis module is unavailable");
  }
  return SystemTtsSynthesis.synthesizeToFile(text, options);
}
