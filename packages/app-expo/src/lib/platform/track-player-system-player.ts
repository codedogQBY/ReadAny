import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
import { splitIntoChunks } from "@readany/core/tts";
import { File } from "expo-file-system";
import { Image, NativeModules } from "react-native";
import TrackPlayer, { Event, State } from "react-native-track-player";

import { synthesizeSystemTtsToFile } from "./system-tts-synthesis";
import { chunkIndexFromTrackId, trackIdForChunkIndex } from "./track-player-chunk-id";

const CHUNK_MAX_CHARS = 500;
const INITIAL_BUFFER_CHUNKS = 3;
const MEDIA_ARTIST = "ReadAny";
const DEFAULT_ARTWORK = (() => {
  try {
    return Image.resolveAssetSource(require("../../../assets/icon.png"))?.uri || "";
  } catch {
    return "";
  }
})();

export class TrackPlayerSystemTTSPlayer implements ITTSPlayer {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onVirtualProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onEnd?: () => void;

  private _stopped = false;
  private _paused = false;
  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _tempFiles: string[] = [];
  private _speakGen = 0;
  private _unsubscribers: (() => void)[] = [];
  private _playStarted = false;
  private _lastNotifiedIndex = -1;
  private _progressPollTimer: ReturnType<typeof setInterval> | null = null;
  private _getArtwork: (() => string | undefined) | null = null;
  private _currentArtwork = DEFAULT_ARTWORK;
  private _getTitle: (() => string | undefined) | null = null;
  private _currentTitle = "";
  private _queuedCount = 0;
  private _synthesisComplete = false;
  private _chapterPrefixCharacters: number | null = null;
  private _chapterTotalCharacters: number | null = null;
  private _secondsPerCharacterEstimate: number | null = null;

  setArtworkGetter(getter: () => string | undefined): void {
    this._getArtwork = getter;
  }

  setTitleGetter(getter: () => string | undefined): void {
    this._getTitle = getter;
  }

  setChapterProgressBounds(
    prefixCharacters: number,
    totalCharacters: number,
    virtualProgress?: { positionSeconds: number; durationSeconds: number },
  ): void {
    this._chapterPrefixCharacters = Math.max(0, prefixCharacters);
    this._chapterTotalCharacters = Math.max(this._chapterPrefixCharacters, totalCharacters);
    if (!virtualProgress || virtualProgress.durationSeconds <= 0) return;

    // Anchor the chapter coordinate system to the duration exposed to Android.
    // Otherwise the next poll re-estimates progress from one sentence's speed
    // and makes a seek appear to jump back to the beginning.
    this._secondsPerCharacterEstimate =
      virtualProgress.durationSeconds / Math.max(1, this._chapterTotalCharacters);
    NativeModules.TrackPlayerModule.setVirtualProgress(
      virtualProgress.positionSeconds,
      virtualProgress.durationSeconds,
    ).catch(() => {});
    this.onVirtualProgress?.(virtualProgress.positionSeconds, virtualProgress.durationSeconds);
  }

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    const gen = ++this._speakGen;
    await this._cleanup();
    if (gen !== this._speakGen) return;

    this._stopped = false;
    this._paused = false;
    this._chunks = Array.isArray(text)
      ? text.map((chunk) => chunk.trim()).filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    this._currentIndex = 0;
    this._tempFiles = [];
    this._playStarted = false;
    this._lastNotifiedIndex = -1;
    this._currentArtwork = this._getArtwork?.() || DEFAULT_ARTWORK;
    this._currentTitle = this._getTitle?.() || "";
    this._queuedCount = 0;
    this._synthesisComplete = false;
    this._chapterPrefixCharacters = null;
    this._chapterTotalCharacters = null;
    this._secondsPerCharacterEstimate = null;

    if (this._chunks.length === 0) {
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    await TrackPlayer.reset();
    this._subscribeToEvents(gen);
    await NativeModules.TrackPlayerModule.setRate(config.rate, config.pitch);
    this.onStateChange?.("playing");

    const initialBufferCount = Math.min(INITIAL_BUFFER_CHUNKS, this._chunks.length);
    for (let i = 0; i < initialBufferCount; i++) {
      const queued = await this._synthesizeAndQueueChunk(gen, config, i);
      if (!queued || gen !== this._speakGen || this._stopped) return;
    }
    this._synthesisComplete = initialBufferCount >= this._chunks.length;

    await this._startPlayback(gen);
    if (!this._synthesisComplete) {
      void this._synthesizeAndQueueRemainder(gen, config, initialBufferCount);
    }
  }

  pause(): void {
    if (this._stopped || this._paused) return;
    this._paused = true;
    this._stopProgressPolling();
    TrackPlayer.pause().catch((err) => console.warn("[TTS] TrackPlayer pause failed:", err));
    this.onStateChange?.("paused");
  }

  resume(): void {
    if (this._stopped || !this._paused) return;
    this._paused = false;
    TrackPlayer.play().catch((err) => console.warn("[TTS] TrackPlayer play failed:", err));
    this._playStarted = true;
    this._startProgressPolling(this._speakGen);
    this.onStateChange?.("playing");
  }

  async seekToChunk(index: number): Promise<boolean> {
    if (this._stopped || index < 0 || index >= this._chunks.length) return false;

    try {
      const queue = await TrackPlayer.getQueue();
      console.log("[TTS] Seek within native queue", {
        index,
        queueLength: queue.length,
        expectedTrackId: trackIdForChunkIndex(index),
        actualTrackId: queue[index]?.id,
      });
      if (queue[index]?.id !== trackIdForChunkIndex(index)) return false;

      const wasPaused = this._paused;
      await TrackPlayer.skip(index);
      await TrackPlayer.seekTo(0);
      if (wasPaused) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }

      this._currentIndex = index;
      this._lastNotifiedIndex = -1;
      this._notifyChunkChange(index);
      this.onStateChange?.(wasPaused ? "paused" : "playing");
      console.log("[TTS] Seek within native queue committed", { index });
      return true;
    } catch (error) {
      console.warn("[TTS] TrackPlayer seek within queue failed:", error);
      return false;
    }
  }

  stop(): void {
    this._stopped = true;
    this._paused = false;
    this._playStarted = false;
    this._stopProgressPolling();
    TrackPlayer.stop().catch(() => {});
    TrackPlayer.reset().catch(() => {});
    this._cleanupEvents();
    this._cleanupTempFiles();
    this.onStateChange?.("stopped");
  }

  private async _synthesizeAndQueueRemainder(
    gen: number,
    config: TTSConfig,
    startIndex: number,
  ): Promise<void> {
    try {
      for (let i = startIndex; i < this._chunks.length; i++) {
        const queued = await this._synthesizeAndQueueChunk(gen, config, i);
        if (!queued) return;
      }
      if (gen !== this._speakGen || this._stopped) return;
      this._synthesisComplete = true;
    } catch (error) {
      if (gen !== this._speakGen || this._stopped) return;
      console.warn("[TrackPlayerSystemTTSPlayer] synthesis failed:", error);
      this._stopped = true;
      this.onStateChange?.("stopped");
    }
  }

  private async _synthesizeAndQueueChunk(
    gen: number,
    config: TTSConfig,
    index: number,
  ): Promise<boolean> {
    if (gen !== this._speakGen || this._stopped) return false;
    const chunk = this._chunks[index];
    const audioUri = await synthesizeSystemTtsToFile(chunk, {
      rate: config.rate,
      pitch: config.pitch,
      language: config.voiceName ? undefined : guessLanguage(chunk),
      voice: config.voiceName,
    });
    if (gen !== this._speakGen || this._stopped) {
      deleteTempFile(audioUri);
      return false;
    }
    this._tempFiles.push(audioUri);
    await TrackPlayer.add({
      id: trackIdForChunkIndex(index),
      url: audioUri,
      title: this._currentTitle || `Segment ${index + 1}`,
      artist: MEDIA_ARTIST,
      album: this._currentTitle || "ReadAny TTS",
      description: chunk.slice(0, 240),
      artwork: this._currentArtwork,
    });
    this._queuedCount = Math.max(this._queuedCount, index + 1);

    if (this._playStarted && !this._paused && !this._stopped) {
      const playbackState = await TrackPlayer.getPlaybackState().catch(() => null);
      if (gen !== this._speakGen || this._stopped) return false;
      if (playbackState?.state === State.Ended || playbackState?.state === State.Stopped) {
        await TrackPlayer.play().catch((err) =>
          console.warn("[TTS] TrackPlayer resume after queue growth failed:", err),
        );
      }
    }
    return true;
  }

  private async _startPlayback(gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped || this._paused || this._playStarted) return;
    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) {
      this._stopped = true;
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }
    await TrackPlayer.play();
    this._playStarted = true;
    this._startProgressPolling(gen);
    this._notifyChunkChange(0);
    this.onStateChange?.("playing");
  }

  private _subscribeToEvents(gen: number): void {
    this._cleanupEvents();

    const unsubTrackChange = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      (event) => {
        if (gen !== this._speakGen || this._stopped) return;
        const chunkIndex = chunkIndexFromTrackId(event.track?.id);
        if (chunkIndex != null) this._notifyChunkChange(chunkIndex);
      },
    );

    const unsubStateChange = TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      if (gen !== this._speakGen || this._stopped) return;
      if (event.state === State.Playing) {
        if (this._paused) {
          TrackPlayer.pause().catch((err) => console.warn("[TTS] TrackPlayer pause failed:", err));
          this.onStateChange?.("paused");
          return;
        }
        this.onStateChange?.("playing");
      } else if (event.state === State.Paused) {
        if (this._paused) this.onStateChange?.("paused");
      } else if (event.state === State.Ended || event.state === State.Stopped) {
        this._handlePlaybackEnded(gen);
      } else if (event.state === State.Error) {
        console.warn("[TrackPlayerSystemTTSPlayer] playback error");
        this._stopped = true;
        this.onStateChange?.("stopped");
      }
    });

    const unsubQueueEnded = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      if (gen !== this._speakGen || this._stopped) return;
      this._handlePlaybackEnded(gen);
    });

    this._unsubscribers.push(
      unsubTrackChange.remove,
      unsubStateChange.remove,
      unsubQueueEnded.remove,
    );
  }

  private _notifyChunkChange(index: number): void {
    if (!Number.isFinite(index) || index < 0 || index >= this._chunks.length) return;
    if (index === this._lastNotifiedIndex) return;
    this._lastNotifiedIndex = index;
    this._currentIndex = index;
    this.onChunkChange?.(index, this._chunks.length);
  }

  private _updateVirtualProgress(
    index: number,
    positionSeconds: number,
    durationSeconds: number,
  ): void {
    if (index < 0 || index >= this._chunks.length || durationSeconds <= 0) return;

    const currentCharacters = Math.max(1, this._chunks[index].trim().length);
    const queuePreviousCharacters = this._chunks
      .slice(0, index)
      .reduce((sum, chunk) => sum + Math.max(1, chunk.trim().length), 0);
    const queueCharacters = this._chunks.reduce(
      (sum, chunk) => sum + Math.max(1, chunk.trim().length),
      0,
    );
    const chapterPrefixCharacters = this._chapterPrefixCharacters ?? 0;
    const previousCharacters = chapterPrefixCharacters + queuePreviousCharacters;
    const totalCharacters =
      this._chapterTotalCharacters ?? chapterPrefixCharacters + queueCharacters;
    const fractionInChunk = Math.max(0, Math.min(1, positionSeconds / durationSeconds));
    const observedSecondsPerCharacter = durationSeconds / currentCharacters;
    this._secondsPerCharacterEstimate =
      this._secondsPerCharacterEstimate === null
        ? observedSecondsPerCharacter
        : this._secondsPerCharacterEstimate * 0.8 + observedSecondsPerCharacter * 0.2;
    const secondsPerCharacter = this._secondsPerCharacterEstimate;
    const virtualPosition =
      Math.min(totalCharacters, previousCharacters + currentCharacters * fractionInChunk) *
      secondsPerCharacter;
    const virtualDuration = Math.max(virtualPosition, totalCharacters * secondsPerCharacter);

    NativeModules.TrackPlayerModule.setVirtualProgress(virtualPosition, virtualDuration).catch(
      () => {},
    );
    this.onVirtualProgress?.(virtualPosition, virtualDuration);
  }

  private _startProgressPolling(gen: number): void {
    this._stopProgressPolling();
    this._progressPollTimer = setInterval(() => {
      void this._pollProgress(gen);
    }, 350);
  }

  private _stopProgressPolling(): void {
    if (!this._progressPollTimer) return;
    clearInterval(this._progressPollTimer);
    this._progressPollTimer = null;
  }

  private async _pollProgress(gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped) {
      this._stopProgressPolling();
      return;
    }
    if (this._paused) return;

    const [activeTrack, playbackState, progress] = await Promise.all([
      TrackPlayer.getActiveTrack().catch(() => null),
      TrackPlayer.getPlaybackState().catch(() => null),
      TrackPlayer.getProgress().catch(() => null),
    ]);
    if (gen !== this._speakGen || this._stopped) return;
    const chunkIndex = chunkIndexFromTrackId(activeTrack?.id);
    if (chunkIndex != null) this._notifyChunkChange(chunkIndex);
    if (chunkIndex != null && progress?.duration) {
      this._updateVirtualProgress(chunkIndex, progress.position, progress.duration);
    }
    if (playbackState?.state === State.Ended || playbackState?.state === State.Stopped) {
      this._handlePlaybackEnded(gen);
    }
  }

  private _handlePlaybackEnded(gen: number): void {
    if (gen !== this._speakGen || this._stopped || this._paused) return;
    if (this._synthesisComplete && this._currentIndex >= this._chunks.length - 1) {
      this._finishPlayback();
    }
  }

  private _finishPlayback(): void {
    if (this._stopped) return;
    this._stopped = true;
    this._paused = false;
    this._playStarted = false;
    this._queuedCount = 0;
    this._synthesisComplete = false;
    this._stopProgressPolling();
    this.onStateChange?.("stopped");
    this.onEnd?.();
  }

  private async _cleanup(): Promise<void> {
    this._stopped = true;
    this._paused = false;
    this._playStarted = false;
    this._stopProgressPolling();
    this._cleanupEvents();
    await TrackPlayer.stop().catch(() => {});
    await TrackPlayer.reset().catch(() => {});
    this._cleanupTempFiles();
  }

  private _cleanupEvents(): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  private _cleanupTempFiles(): void {
    for (const uri of this._tempFiles) {
      try {
        new File(uri).delete();
      } catch {}
    }
    this._tempFiles = [];
  }
}

function deleteTempFile(uri: string): void {
  try {
    new File(uri).delete();
  } catch {}
}

function guessLanguage(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (cjk && cjk.length > text.length * 0.1) return "zh-CN";
  return "en-US";
}
