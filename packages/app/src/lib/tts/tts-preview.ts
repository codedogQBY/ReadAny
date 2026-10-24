import type { TTSConfig } from "@readany/core/tts";
import {
  BrowserTTSPlayer,
  DashScopeTTSPlayer,
  EdgeTTSPlayer,
  OpenAICompatibleTTSPlayer,
  VoxCPMTTSPlayer,
  XiaomiTTSPlayer,
} from "@readany/core/tts";

const systemPreviewPlayer = new BrowserTTSPlayer();
const edgePreviewPlayer = new EdgeTTSPlayer();
const dashscopePreviewPlayer = new DashScopeTTSPlayer();
const xiaomiPreviewPlayer = new XiaomiTTSPlayer();
const openAICompatiblePreviewPlayer = new OpenAICompatibleTTSPlayer();
const voxcpmPreviewPlayer = new VoxCPMTTSPlayer();

export interface TTSPreviewCallbacks {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onEnd?: () => void;
}

function stopPlayer(player: { stop: () => void }) {
  try {
    player.stop();
  } catch (err) {
    console.warn("[TTS] Failed to stop preview player:", err);
  }
}

export function stopTTSPreview() {
  stopPlayer(systemPreviewPlayer);
  stopPlayer(edgePreviewPlayer);
  stopPlayer(dashscopePreviewPlayer);
  stopPlayer(xiaomiPreviewPlayer);
  stopPlayer(openAICompatiblePreviewPlayer);
  stopPlayer(voxcpmPreviewPlayer);
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
        : config.engine === "xiaomi"
          ? xiaomiPreviewPlayer
          : config.engine === "openai-compatible"
            ? openAICompatiblePreviewPlayer
            : config.engine === "voxcpm"
              ? voxcpmPreviewPlayer
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
