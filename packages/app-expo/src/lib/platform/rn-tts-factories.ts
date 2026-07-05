/**
 * React Native TTS player factories.
 *
 * - SystemTTS  → Native synthesis + TrackPlayer on iOS/Android for background media controls
 * - EdgeTTS    → react-native-track-player + Edge TTS WebSocket API (background + notification controls)
 * - DashScope  → react-native-track-player + DashScope MP3 API (background + notification controls)
 */
import type { TTSPlayerFactories } from "@readany/core/stores";
import { Platform } from "react-native";
import { ExpoSpeechTTSPlayer } from "./expo-speech-player";
import { canUseSystemTtsSynthesis } from "./system-tts-synthesis";
import { TrackPlayerDashScopeTTSPlayer } from "./track-player-dashscope-player";
import { TrackPlayerEdgeTTSPlayer } from "./track-player-edge-player";
import { TrackPlayerSystemTTSPlayer } from "./track-player-system-player";

export const rnTTSPlayerFactories: TTSPlayerFactories = {
  createSystemTTS: () => {
    if (Platform.OS === "android" || Platform.OS === "ios") {
      if (!canUseSystemTtsSynthesis()) {
        console.warn("[TTS] System TTS synthesis module unavailable; native rebuild required");
      }
      return new TrackPlayerSystemTTSPlayer();
    }
    return new ExpoSpeechTTSPlayer();
  },
  createEdgeTTS: () => new TrackPlayerEdgeTTSPlayer(),
  createDashScopeTTS: () => new TrackPlayerDashScopeTTSPlayer(),
};
