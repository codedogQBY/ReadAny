import {
  type ITTSPlayer,
  type TTSConfig,
  fetchOpenAITTSAudio,
  fetchXiaomiTTSWav,
  isTTSAbortError,
  splitIntoChunks,
} from "@readany/core/tts";
import { File, Paths } from "expo-file-system";
import { Image } from "react-native";
import TrackPlayer, { Event, State } from "react-native-track-player";

const CHUNK_MAX_CHARS = 500;
const PREFETCH_AHEAD_CHUNKS = 2;
const END_ADVANCE_TOLERANCE_SECONDS = 0.35;
const END_WATCHDOG_INTERVAL_MS = 700;
const MEDIA_ARTIST = "ReadAny";
const DEFAULT_ARTWORK = (() => {
  try {
    return Image.resolveAssetSource(require("../../../assets/icon.png"))?.uri || "";
  } catch {
    return "";
  }
})();

function extensionForConfig(config: TTSConfig): string {
  if (config.engine === "xiaomi") return "wav";
  if (config.openaiTtsEndpoint === "chat-completions") {
    return config.openaiTtsFormat === "pcm16" ? "wav" : config.openaiTtsFormat;
  }
  return config.openaiTtsFormat || "mp3";
}

export class TrackPlayerCloudTTSPlayer implements ITTSPlayer {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  private _stopped = true;
  private _paused = false;
  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _config: TTSConfig | null = null;
  private _tempFiles: string[] = [];
  private _speakGen = 0;
  private _unsubscribers: (() => void)[] = [];
  private _getArtwork: (() => string | undefined) | null = null;
  private _getTitle: (() => string | undefined) | null = null;
  private _advancing = false;
  private _lastNotifiedIndex = -1;
  private _prefetches = new Map<number, Promise<string>>();
  private _trackStartedAt = 0;
  private _endWatchdog: ReturnType<typeof setInterval> | null = null;

  get paused(): boolean {
    return this._paused;
  }

  setArtworkGetter(getter: () => string | undefined): void {
    this._getArtwork = getter;
  }

  setTitleGetter(getter: () => string | undefined): void {
    this._getTitle = getter;
  }

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    const gen = ++this._speakGen;
    await this._cleanup();
    if (gen !== this._speakGen) return;

    this._stopped = false;
    this._paused = false;
    this._config = config;
    this._chunks = Array.isArray(text)
      ? text.map((chunk) => chunk.trim()).filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    this._currentIndex = 0;
    this._tempFiles = [];
    this._advancing = false;
    this._lastNotifiedIndex = -1;
    this._prefetches.clear();
    this._trackStartedAt = 0;
    this._clearEndWatchdog();

    if (this._chunks.length === 0) {
      this._finishPlayback();
      return;
    }

    await TrackPlayer.reset();
    this._subscribeToEvents(gen);
    await this._playChunk(0, gen);
  }

  append(text: string | string[]): void {
    if (this._stopped) return;
    const chunks = Array.isArray(text)
      ? text.map((chunk) => chunk.trim()).filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    this._chunks.push(...chunks);
  }

  private _subscribeToEvents(gen: number): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];

    const unsubState = TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      if (gen !== this._speakGen || this._stopped) return;
      if (event.state === State.Playing) {
        this.onStateChange?.("playing");
      } else if (event.state === State.Paused) {
        this.onStateChange?.(this._paused ? "paused" : "playing");
      } else if (event.state === State.Ended || event.state === State.Stopped) {
        void this._handlePlaybackEnded(gen);
      } else if (event.state === State.Error) {
        console.warn("[TrackPlayerCloudTTSPlayer] playback error");
        void this._handlePlaybackEnded(gen, { force: true });
      }
    });

    const unsubQueueEnded = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      if (gen !== this._speakGen || this._stopped) return;
      void this._handlePlaybackEnded(gen);
    });

    this._unsubscribers.push(unsubState.remove, unsubQueueEnded.remove);
  }

  private async _playNext(gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped) return;
    if (this._paused) return;
    if (this._advancing) return;
    this._advancing = true;
    const next = this._currentIndex + 1;
    try {
      if (next >= this._chunks.length) {
        this._finishPlayback();
        return;
      }
      await this._playChunk(next, gen);
    } finally {
      this._advancing = false;
    }
  }

  private async _playChunk(index: number, gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped || !this._config) return;
    this._currentIndex = index;

    try {
      const uriPromise = this._takePrefetchedChunk(index, gen);
      this._prefetchUpcomingChunks(index, gen);
      const uri = await uriPromise;
      if (gen !== this._speakGen || this._stopped) return;
      this._clearEndWatchdog();
      this._trackStartedAt = 0;
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: `cloud-tts-${index}`,
        url: uri,
        title: this._getTitle?.() || "ReadAny",
        artist: MEDIA_ARTIST,
        artwork: this._getArtwork?.() || DEFAULT_ARTWORK,
      });
      if (!this._paused) {
        await TrackPlayer.play();
        if (gen !== this._speakGen || this._stopped || this._paused) return;
        this._trackStartedAt = Date.now();
        this._notifyChunkChange(index);
        this._startEndWatchdog(gen);
        this.onStateChange?.("playing");
      }
    } catch (error) {
      if ((error as Error)?.message === "aborted" || isTTSAbortError(error)) return;
      console.warn("[TrackPlayerCloudTTSPlayer] chunk error:", error);
      await this._skipFailedChunk(index, gen);
    }
  }

  private async _handlePlaybackEnded(
    gen: number,
    options: { force?: boolean; allowUnknownDuration?: boolean } = {},
  ): Promise<void> {
    if (gen !== this._speakGen || this._stopped || this._paused || this._advancing) return;
    if (!options.force) {
      const canAdvance = await this._isCurrentTrackReallyFinished(
        gen,
        options.allowUnknownDuration ?? true,
      );
      if (!canAdvance) return;
    }
    await this._playNext(gen);
  }

  private async _isCurrentTrackReallyFinished(
    gen: number,
    allowUnknownDuration: boolean,
  ): Promise<boolean> {
    if (gen !== this._speakGen || this._stopped || this._paused) return false;
    if (this._trackStartedAt <= 0) return false;

    const progress = await TrackPlayer.getProgress().catch(() => null);
    if (gen !== this._speakGen || this._stopped || this._paused) return false;
    if (!progress || progress.duration <= 0) return allowUnknownDuration;

    const remaining = progress.duration - progress.position;
    return progress.position > 0 && remaining <= END_ADVANCE_TOLERANCE_SECONDS;
  }

  private _startEndWatchdog(gen: number): void {
    this._clearEndWatchdog();
    this._endWatchdog = setInterval(() => {
      if (gen !== this._speakGen || this._stopped || this._paused) {
        this._clearEndWatchdog();
        return;
      }
      void this._handlePlaybackEnded(gen, { allowUnknownDuration: false });
    }, END_WATCHDOG_INTERVAL_MS);
  }

  private _clearEndWatchdog(): void {
    if (!this._endWatchdog) return;
    clearInterval(this._endWatchdog);
    this._endWatchdog = null;
  }

  private async _skipFailedChunk(index: number, gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped || this._paused) return;
    const next = index + 1;
    if (next >= this._chunks.length) {
      this._finishPlayback();
      return;
    }
    await this._playChunk(next, gen);
  }

  private _prefetchUpcomingChunks(index: number, gen: number): void {
    for (let offset = 1; offset <= PREFETCH_AHEAD_CHUNKS; offset++) {
      const nextIndex = index + offset;
      if (nextIndex >= this._chunks.length) break;
      this._prefetchChunk(nextIndex, gen);
    }
  }

  private _prefetchChunk(index: number, gen: number): void {
    if (this._prefetches.has(index)) return;
    const promise = this._fetchChunkFile(index, gen).catch((error) => {
      this._prefetches.delete(index);
      throw error;
    });
    void promise.catch(() => {});
    this._prefetches.set(index, promise);
  }

  private async _takePrefetchedChunk(index: number, gen: number): Promise<string> {
    const existing = this._prefetches.get(index);
    if (existing) {
      this._prefetches.delete(index);
      return existing;
    }
    return this._fetchChunkFile(index, gen);
  }

  private _notifyChunkChange(index: number): void {
    if (!Number.isFinite(index) || index < 0 || index >= this._chunks.length) return;
    if (index === this._lastNotifiedIndex) return;
    this._lastNotifiedIndex = index;
    this._currentIndex = index;
    this.onChunkChange?.(index, this._chunks.length);
  }

  private async _fetchChunkFile(index: number, gen: number): Promise<string> {
    if (this._stopped || gen !== this._speakGen || !this._config) throw new Error("aborted");
    const config = this._config;
    const bytes =
      config.engine === "xiaomi"
        ? await fetchXiaomiTTSWav(this._chunks[index], config)
        : await fetchOpenAITTSAudio(this._chunks[index], config);
    if (this._stopped || gen !== this._speakGen) throw new Error("aborted");

    const ext = extensionForConfig(config);
    const tmpFile = new File(Paths.cache, `tts_${config.engine}_${index}_${Date.now()}.${ext}`);
    const audioUri = tmpFile.uri;
    this._tempFiles.push(audioUri);
    tmpFile.write(bytes);
    return audioUri;
  }

  pause(): void {
    if (this._stopped || this._paused) return;
    this._paused = true;
    this._clearEndWatchdog();
    TrackPlayer.pause();
    this.onStateChange?.("paused");
  }

  resume(): void {
    if (this._stopped || !this._paused) return;
    this._paused = false;
    TrackPlayer.play();
    this._startEndWatchdog(this._speakGen);
    this.onStateChange?.("playing");
  }

  stop(): void {
    this._stopped = true;
    this._paused = false;
    this._advancing = false;
    this._speakGen += 1;
    this._prefetches.clear();
    this._trackStartedAt = 0;
    this._clearEndWatchdog();
    TrackPlayer.stop();
    TrackPlayer.reset();
    this._cleanupEvents();
    this._cleanupTempFiles();
    this.onStateChange?.("stopped");
  }

  private _finishPlayback(): void {
    if (this._stopped) return;
    this._stopped = true;
    this._paused = false;
    this._clearEndWatchdog();
    this._cleanupEvents();
    this.onStateChange?.("stopped");
    this.onEnd?.();
  }

  private async _cleanup(): Promise<void> {
    this._stopped = true;
    this._paused = false;
    await TrackPlayer.stop().catch(() => {});
    await TrackPlayer.reset().catch(() => {});
    this._prefetches.clear();
    this._trackStartedAt = 0;
    this._clearEndWatchdog();
    this._cleanupEvents();
    this._cleanupTempFiles();
  }

  private _cleanupEvents(): void {
    this._clearEndWatchdog();
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
