import type { TTSConfig } from "@readany/core/tts";
import { ExpoSpeechTTSPlayer } from "./expo-speech-player";
import { TrackPlayerCloudTTSPlayer } from "./track-player-cloud-tts-player";
import { TrackPlayerEdgeTTSPlayer } from "./track-player-edge-player";

const systemPreviewPlayer = new ExpoSpeechTTSPlayer();
const edgePreviewPlayer = new TrackPlayerEdgeTTSPlayer();
const dashscopePreviewPlayer = new ExpoSpeechTTSPlayer();
const cloudPreviewPlayer = new TrackPlayerCloudTTSPlayer();

export interface TTSPreviewCallbacks {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onEnd?: () => void;
}

function stopPlayer(player: { stop: () => void }) {
  try {
    player.stop();
  } catch {}
}

export function stopTTSPreview() {
  stopPlayer(systemPreviewPlayer);
  stopPlayer(edgePreviewPlayer);
  stopPlayer(dashscopePreviewPlayer);
  stopPlayer(cloudPreviewPlayer);
}

export async function previewTTSConfig(
  text: string,
  config: TTSConfig,
  callbacks: TTSPreviewCallbacks = {},
) {
  stopTTSPreview();
  const player =
    config.engine === "edge"
      ? edgePreviewPlayer
      : config.engine === "dashscope"
        ? dashscopePreviewPlayer
        : config.engine === "xiaomi" || config.engine === "openai-compatible"
          ? cloudPreviewPlayer
          : systemPreviewPlayer;
  player.onStateChange = undefined;
  player.onEnd = undefined;
  try {
    const preview = Promise.resolve(player.speak(text, config));
    player.onStateChange = callbacks.onStateChange;
    player.onEnd = callbacks.onEnd;
    await preview;
  } catch (error) {
    console.error("[TTSPreview] Preview failed", error);
    callbacks.onStateChange?.("stopped");
  }
}
