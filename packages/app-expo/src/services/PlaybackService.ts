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

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    // Handled by App.tsx TTS store bridge
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    // Handled by App.tsx TTS store bridge
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });
}
