/**
 * React Native TTS player factories.
 *
 * - BrowserTTS → expo-speech (native OS TTS, background NOT guaranteed)
 * - EdgeTTS    → expo-av + Edge TTS WebSocket API (background audio supported)
 * - DashScope  → expo-speech fallback (PCM streaming on RN pending expo-av integration)
 * - MiMo       → expo-speech fallback (cloud audio playback pending expo-av integration)
 */
import type { TTSPlayerFactories } from "@readany/core/stores";
import { ExpoAVEdgeTTSPlayer } from "./expo-av-edge-player";
import { ExpoSpeechTTSPlayer } from "./expo-speech-player";

export const rnTTSPlayerFactories: TTSPlayerFactories = {
  createSystemTTS: () => new ExpoSpeechTTSPlayer(),
  createEdgeTTS: () => new ExpoAVEdgeTTSPlayer(),
  // DashScope TTS needs PCM streaming via expo-av — falls back to expo-speech for now.
  createDashScopeTTS: () => new ExpoSpeechTTSPlayer(),
  createMiMoTTS: () => new ExpoSpeechTTSPlayer(),
};
