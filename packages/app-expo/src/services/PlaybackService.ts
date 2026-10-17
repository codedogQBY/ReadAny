/**
 * react-native-track-player PlaybackService
 *
 * Required on Android to keep the foreground service alive for media playback.
 * Without this registration, some Android devices crash when TrackPlayer
 * attempts to start its ForegroundService.
 *
 * Remote events (play/pause/stop/next/prev) are handled here and forwarded to
 * the TTS store. Keep these listeners only in the playback service; registering
 * them in App.tsx as well makes every media button run twice.
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
    const { onEnd, onNext } = useTTSStore.getState();
    console.log("[PlaybackService] RemoteNext", {
      hasNextCallback: !!onNext,
      hasEndCallback: !!onEnd,
    });
    (onNext || onEnd)?.();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    const { onPrevious } = useTTSStore.getState();
    console.log("[PlaybackService] RemotePrevious", {
      hasPreviousCallback: !!onPrevious,
    });
    useTTSStore.getState().onPrevious?.();
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    const { onSeek, virtualDuration } = useTTSStore.getState();
    console.log("[PlaybackService] RemoteSeek", {
      position: event.position,
      virtualDuration,
      hasSeekCallback: !!onSeek,
    });
    onSeek?.(event.position, virtualDuration);
  });
}
