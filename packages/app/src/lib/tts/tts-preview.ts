import type { TTSConfig } from "@readany/core/tts";
import { BrowserTTSPlayer, DashScopeTTSPlayer, EdgeTTSPlayer, MiMoTTSPlayer } from "@readany/core/tts";

const systemPreviewPlayer = new BrowserTTSPlayer();
const edgePreviewPlayer = new EdgeTTSPlayer();
const dashscopePreviewPlayer = new DashScopeTTSPlayer();
const mimoPreviewPlayer = new MiMoTTSPlayer();

function stopPlayer(player: { stop: () => void }) {
  try {
    player.stop();
  } catch {}
}

export function stopTTSPreview() {
  stopPlayer(systemPreviewPlayer);
  stopPlayer(edgePreviewPlayer);
  stopPlayer(dashscopePreviewPlayer);
  stopPlayer(mimoPreviewPlayer);
}

export async function previewTTSConfig(text: string, config: TTSConfig) {
  stopTTSPreview();
  const player =
    config.engine === "edge"
      ? edgePreviewPlayer
      : config.engine === "dashscope"
        ? dashscopePreviewPlayer
        : config.engine === "mimo"
          ? mimoPreviewPlayer
          : systemPreviewPlayer;
  try {
    await Promise.resolve(player.speak(text, config));
  } catch (error) {
    console.error("[TTSPreview] Preview failed", error);
  }
}
