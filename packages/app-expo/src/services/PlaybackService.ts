/**
 * react-native-track-player PlaybackService
 *
 * Required on Android to keep the foreground service alive for media playback.
 * Without this registration, some Android devices crash when TrackPlayer
 * attempts to start its ForegroundService.
 *
 * Remote events (play/pause/stop/next/prev) are handled here and forwarded
 * to the TTS store, duplicating the handlers in App.tsx bootstrap for safety.
 * The App.tsx handlers remain as a fallback for cases where the service
 * handler hasn't loaded yet.
 */
import TrackPlayer, { Event } from "react-native-track-player";
import { useTTSStore } from "../stores/tts-store";

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    useTTSStore.getState().resume();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    useTTSStore.getState().pause();
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    useTTSStore.getState().stop();
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    const { currentChunkIndex, jumpToChunk, totalChunks } = useTTSStore.getState();
    const nextIndex = currentChunkIndex + 1;
    if (nextIndex < totalChunks) {
      jumpToChunk(nextIndex);
    }
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    const { currentChunkIndex, jumpToChunk } = useTTSStore.getState();
    const prevIndex = currentChunkIndex - 1;
    if (prevIndex >= 0) {
      jumpToChunk(prevIndex);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });
}
