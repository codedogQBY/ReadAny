import type { TTSConfig, TTSPlayState } from "./types";

/** Debounce window (ms) before re-speaking from the current sentence after a
 *  synthesis-affecting config change (voice/rate/pitch). */
export const VOICE_RESPEAK_DEBOUNCE_MS = 250;

export function isActivePlay(state: TTSPlayState): boolean {
  return state === "playing" || state === "loading";
}

/** Whether a config change altered a synthesis-affecting parameter for the
 *  *current* engine, warranting a re-speak from the current sentence.
 *  DashScope only honors voice (it does not send rate/pitch). */
export function shouldRespeakForSynthChange(prev: TTSConfig, next: TTSConfig): boolean {
  if (next.engine === "dashscope") {
    return !!next.dashscopeApiKey && next.dashscopeVoice !== prev.dashscopeVoice;
  }
  if (next.engine === "xiaomi") {
    return (
      !!next.xiaomiApiKey &&
      (next.xiaomiBaseUrl !== prev.xiaomiBaseUrl ||
        next.xiaomiVoice !== prev.xiaomiVoice ||
        next.xiaomiStylePrompt !== prev.xiaomiStylePrompt)
    );
  }
  if (next.engine === "openai-compatible") {
    return (
      !!next.openaiTtsApiKey &&
      (next.openaiTtsBaseUrl !== prev.openaiTtsBaseUrl ||
        next.openaiTtsEndpoint !== prev.openaiTtsEndpoint ||
        next.openaiTtsModel !== prev.openaiTtsModel ||
        next.openaiTtsVoice !== prev.openaiTtsVoice ||
        next.openaiTtsFormat !== prev.openaiTtsFormat ||
        next.openaiTtsStylePrompt !== prev.openaiTtsStylePrompt)
    );
  }
  if (next.engine === "voxcpm") {
    return (
      next.voxcpmBaseUrl !== prev.voxcpmBaseUrl ||
      next.voxcpmModel !== prev.voxcpmModel ||
      next.voxcpmVoice !== prev.voxcpmVoice ||
      next.voxcpmFormat !== prev.voxcpmFormat ||
      next.voxcpmVoiceDesign !== prev.voxcpmVoiceDesign
    );
  }
  if (next.engine === "edge") {
    return (
      next.edgeVoice !== prev.edgeVoice || next.rate !== prev.rate || next.pitch !== prev.pitch
    );
  }
  return false;
}
