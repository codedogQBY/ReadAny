import { getPlatformService } from "@readany/core/services";
import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
import { splitIntoChunks } from "@readany/core/tts";
import { File, Paths } from "expo-file-system";
import { AppState, type AppStateStatus, Image, Platform } from "react-native";
import TrackPlayer, { Event, State } from "react-native-track-player";

import { chunkIndexFromTrackId, trackIdForChunkIndex } from "./track-player-chunk-id";
import { ensureSilenceFile } from "./tts-silence-keeper";

const CHUNK_MAX_CHARS = 500;
const MEDIA_ARTIST = "ReadAny";
const DEFAULT_ARTWORK = (() => {
  try {
    return Image.resolveAssetSource(require("../../../assets/icon.png"))?.uri || "";
  } catch {
    return "";
  }
})();

export class TrackPlayerDashScopeTTSPlayer implements ITTSPlayer {
  private static readonly INITIAL_BUFFER_CHUNKS = 8;
  private static readonly FETCH_CONCURRENCY = 8;
  private static readonly STARVE_RESUME_BUFFER_CHUNKS = 2;
  private static readonly MAX_RETRIES = 3;
  private static readonly MAX_CHUNK_FETCH_RETRIES = 4;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  private _stopped = false;
  private _paused = false;
  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _config: TTSConfig | null = null;
  private _tempFiles: string[] = [];
  private _speakGen = 0;
  private _unsubscribers: (() => void)[] = [];
  private _downloadComplete = false;
  private _nextChunkToAdd = 0;
  private _nextChunkToFetch = 0;
  private _fetchPromises = new Map<number, Promise<string>>();
  private _queueStarved = false;
  private _playStarted = false;
  private _lastNotifiedIndex = -1;
  private _progressPollTimer: ReturnType<typeof setInterval> | null = null;
  private _getArtwork: (() => string | undefined) | null = null;
  private _currentArtwork = DEFAULT_ARTWORK;
  private _getTitle: (() => string | undefined) | null = null;
  private _currentTitle = "";
  private _producerRunning = false;
  private _retryCount = 0;
  private _silenceTrackIds = new Set<string>();

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

    if (!config.dashscopeApiKey) {
      console.warn("[TrackPlayerDashScopeTTSPlayer] No API key provided");
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    this._stopped = false;
    this._paused = false;
    this._config = config;
    this._downloadComplete = false;
    this._retryCount = 0;
    this._chunks = Array.isArray(text)
      ? text.filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    this._currentIndex = 0;
    this._tempFiles = [];
    this._nextChunkToAdd = 0;
    this._nextChunkToFetch = 0;
    this._fetchPromises.clear();
    this._queueStarved = false;
    this._playStarted = false;
    this._lastNotifiedIndex = -1;
    this._currentArtwork = this._getArtwork?.() || DEFAULT_ARTWORK;
    this._currentTitle = this._getTitle?.() || "";
    this._producerRunning = false;
    this._silenceTrackIds.clear();

    if (this._chunks.length === 0) {
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    await TrackPlayer.reset();

    this._subscribeToEvents(gen);

    this._ensureProducerRunning(gen);
  }

  append(text: string | string[]): void {
    if (this._stopped || !this._config) return;
    const chunks = Array.isArray(text)
      ? text.map((chunk) => chunk.trim()).filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    if (chunks.length === 0) return;

    this._chunks.push(...chunks);
    this._downloadComplete = false;
    this._ensureProducerRunning(this._speakGen);
  }

  private _subscribeToEvents(gen: number): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];

    const unsubTrackChange = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      (event) => {
        if (gen !== this._speakGen || this._stopped) return;
        // Skip notifications for silence keep-alive tracks
        if (event.track && this._silenceTrackIds.has(event.track.id as string)) return;
        // Resolve chunk index by track ID — silence keep-alive tracks shift
        // queue indices off-by-one or more from chunk indices.
        const chunkIndex = chunkIndexFromTrackId(event.track?.id);
        if (chunkIndex != null) {
          this._notifyChunkChange(chunkIndex);
        }
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
        // RNTP reports Paused for several reasons that are NOT real starvation:
        //   1. The Paused state right after `TrackPlayer.reset()` in speak(),
        //      which fires before any chunk has been added.
        //   2. Brief transitions while RNTP loads the next track (we see this
        //      every time _resumeStarvedQueue calls TrackPlayer.skip()).
        //   3. Transient buffering hiccups while real chunks are queued ahead.
        // Misclassifying any of these as starvation makes _addFetchedChunk
        // call _resumeStarvedQueue → TrackPlayer.skip(currentIndex + 1), which
        // chops off the currently playing track and jumps to the next one.
        //
        // Treat Paused as starvation only when (a) we already started real
        // playback and (b) we genuinely have no chunk queued past the current
        // playing one. Real end-of-queue starvation still gets caught by the
        // PlaybackQueueEnded handler below, which carries an authoritative
        // track index.
        if (this._paused) {
          this.onStateChange?.("paused");
        } else if (!this._downloadComplete && this._playStarted) {
          const hasChunksAhead = this._nextChunkToAdd > this._currentIndex + 1;
          if (!hasChunksAhead) {
            this._markQueueStarved();
          }
        } else if (this._isAtFinalTrack()) {
          this._finishPlayback();
        }
      } else if (event.state === State.Error) {
        if (this._retryCount < TrackPlayerDashScopeTTSPlayer.MAX_RETRIES) {
          this._retryCount++;
          console.warn(
            `[TrackPlayerDashScopeTTSPlayer] playback error, retry ${this._retryCount}/${TrackPlayerDashScopeTTSPlayer.MAX_RETRIES}`,
          );
          TrackPlayer.retry().catch(() => {});
        } else {
          console.error("[TrackPlayerDashScopeTTSPlayer] playback error, max retries reached");
          this._stopped = true;
          this.onStateChange?.("stopped");
        }
      } else if (event.state === State.Ended || event.state === State.Stopped) {
        this._handlePlaybackEnded(gen);
      }
    });

    const unsubQueueEnded = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, (event) => {
      if (gen !== this._speakGen || this._stopped) return;
      this._handlePlaybackEnded(gen, event.track);
    });

    const unsubSeek = TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
      if (gen !== this._speakGen || this._stopped) return;
      TrackPlayer.seekTo(event.position);
    });

    this._unsubscribers.push(
      unsubTrackChange.remove,
      unsubStateChange.remove,
      unsubQueueEnded.remove,
      unsubSeek.remove,
    );

    // Resume chunk fetching when app returns to foreground.
    const appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;
      if (gen !== this._speakGen || this._stopped) return;
      this._ensureProducerRunning(gen);
      this._syncActiveTrackFromNative(gen);
      if (this._queueStarved) {
        this._recoverFromStarvation(gen);
      }
    });
    this._unsubscribers.push(() => appStateSub.remove());
  }

  private _ensureProducerRunning(gen: number): void {
    if (gen !== this._speakGen || this._stopped || this._producerRunning) return;
    if (this._nextChunkToAdd >= this._chunks.length && this._fetchPromises.size === 0) {
      this._downloadComplete = true;
      return;
    }

    this._producerRunning = true;
    void this._runProducer(gen).finally(() => {
      if (gen !== this._speakGen) return;
      this._producerRunning = false;
      if (!this._stopped && !this._paused && this._nextChunkToAdd < this._chunks.length) {
        this._ensureProducerRunning(gen);
      }
    });
  }

  private async _runProducer(gen: number): Promise<void> {
    try {
      const initialBufferCount = Math.min(
        TrackPlayerDashScopeTTSPlayer.INITIAL_BUFFER_CHUNKS,
        this._chunks.length,
      );

      while (this._nextChunkToAdd < this._chunks.length) {
        this._startChunkFetches(gen);
        const nextIndex = this._nextChunkToAdd;
        const fetchPromise = this._fetchPromises.get(nextIndex);
        if (!fetchPromise) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }

        const audioUri = await fetchPromise;
        this._fetchPromises.delete(nextIndex);
        await this._addFetchedChunk(nextIndex, audioUri, gen);

        if (!this._playStarted && this._nextChunkToAdd >= initialBufferCount) {
          await this._startPlayback(gen);
        }
      }

      if (gen !== this._speakGen || this._stopped) return;
      if (this._nextChunkToAdd < this._chunks.length) return;
      this._downloadComplete = true;
      if (!this._playStarted) {
        await this._startPlayback(gen);
      }
      if (this._queueStarved) {
        await this._resumeStarvedQueue(gen);
      }
    } catch (err) {
      if (!this._stopped && (err as Error)?.message !== "aborted") {
        console.error("[TrackPlayerDashScopeTTSPlayer] download error:", err);
        this._stopped = true;
        this.onStateChange?.("stopped");
      }
    }
  }

  private _startChunkFetches(gen: number): void {
    while (
      this._fetchPromises.size < TrackPlayerDashScopeTTSPlayer.FETCH_CONCURRENCY &&
      this._nextChunkToFetch < this._chunks.length
    ) {
      const index = this._nextChunkToFetch++;
      const promise = this._fetchChunkFileWithRetry(index, gen);
      promise.catch(() => {});
      this._fetchPromises.set(index, promise);
    }
  }

  private async _startPlayback(gen: number): Promise<void> {
    if (this._playStarted || gen !== this._speakGen || this._stopped) return;

    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) {
      this._stopped = true;
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    if (this._paused) return;

    await TrackPlayer.play();
    this._playStarted = true;
    this._startProgressPolling(gen);
    const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
    const chunkIndex = chunkIndexFromTrackId(activeTrack?.id);
    if (chunkIndex != null) {
      this._notifyChunkChange(chunkIndex);
    }
    this.onStateChange?.("playing");
  }

  private async _addFetchedChunk(index: number, audioUri: string, gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped) throw new Error("aborted");

    await TrackPlayer.add({
      id: trackIdForChunkIndex(index),
      url: audioUri,
      title: this._currentTitle || `Segment ${index + 1}`,
      artist: MEDIA_ARTIST,
      album: this._currentTitle || "ReadAny TTS",
      description: this._chunks[index]?.slice(0, 240),
      artwork: this._currentArtwork,
    });

    this._nextChunkToAdd = Math.max(this._nextChunkToAdd, index + 1);
    if (this._nextChunkToAdd >= this._chunks.length) {
      this._downloadComplete = true;
    }

    if (this._queueStarved && this._playStarted && this._hasEnoughQueuedToResume()) {
      await this._resumeStarvedQueue(gen);
    }
  }

  private _hasEnoughQueuedToResume(): boolean {
    if (this._downloadComplete) return true;
    const nextPlayableIndex = this._currentIndex + 1;
    const queuedAhead = this._nextChunkToAdd - nextPlayableIndex;
    const remaining = this._chunks.length - nextPlayableIndex;
    const required = Math.min(TrackPlayerDashScopeTTSPlayer.STARVE_RESUME_BUFFER_CHUNKS, remaining);
    return queuedAhead >= required;
  }

  private async _resumeStarvedQueue(gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped || this._paused) return;

    try {
      // Remove silence keep-alive tracks before resuming real audio
      await this._removeSilenceTracks();
      if (gen !== this._speakGen || this._stopped || this._paused) return;

      const queue = await TrackPlayer.getQueue();
      if (queue.length === 0) return;
      if (gen !== this._speakGen || this._stopped || this._paused) return;

      // Resolve queue position by track ID rather than treating chunk index
      // as queue index. See track-player-chunk-id.ts for the why.
      const targetChunkIndex = this._currentIndex + 1;
      const targetTrackId = trackIdForChunkIndex(targetChunkIndex);
      let targetQueuePos = queue.findIndex((track) => track.id === targetTrackId);
      if (targetQueuePos < 0) {
        for (let i = 0; i < queue.length; i++) {
          const idx = chunkIndexFromTrackId(queue[i].id);
          if (idx != null && idx > this._currentIndex) {
            targetQueuePos = i;
            break;
          }
        }
        if (targetQueuePos < 0) return;
      }

      this._queueStarved = false;
      await TrackPlayer.skip(targetQueuePos).catch(() => {});
      if (gen !== this._speakGen || this._stopped || this._paused) return;
      await TrackPlayer.play();
      const resolvedTrack = await TrackPlayer.getActiveTrack().catch(() => null);
      const resolvedChunkIndex = chunkIndexFromTrackId(resolvedTrack?.id) ?? targetChunkIndex;
      this._notifyChunkChange(resolvedChunkIndex);
      this._startProgressPolling(gen);
      this.onStateChange?.("playing");
      console.log("[TrackPlayerDashScopeTTSPlayer] resumed after queue starvation", {
        targetQueuePos,
        resolvedChunkIndex,
        queueLength: queue.length,
      });
    } catch (error) {
      console.warn("[TrackPlayerDashScopeTTSPlayer] failed to resume starved queue", error);
    }
  }

  private async _removeSilenceTracks(): Promise<void> {
    if (this._silenceTrackIds.size === 0) return;
    try {
      const ids = new Set(this._silenceTrackIds);
      this._silenceTrackIds.clear();
      const queue = await TrackPlayer.getQueue();
      const indexes = queue
        .map((track, index) => (ids.has(String(track.id)) ? index : -1))
        .filter((index) => index >= 0)
        .sort((a, b) => b - a);
      if (indexes.length > 0)
        await TrackPlayer.remove(indexes).catch((err) =>
          console.warn("[TTS] TrackPlayer remove failed:", err),
        );
    } catch (err) {
      console.warn("[TTS] Failed to clear silence tracks:", err);
    }
  }

  private async _fetchChunkFileWithRetry(index: number, gen: number): Promise<string> {
    let lastError: unknown = null;

    for (
      let attempt = 0;
      attempt <= TrackPlayerDashScopeTTSPlayer.MAX_CHUNK_FETCH_RETRIES;
      attempt++
    ) {
      try {
        return await this._fetchChunkFile(index, gen);
      } catch (error) {
        if ((error as Error)?.message === "aborted" || gen !== this._speakGen || this._stopped) {
          throw error;
        }
        lastError = error;
        console.warn("[TrackPlayerDashScopeTTSPlayer] chunk fetch failed", {
          index,
          attempt: attempt + 1,
          maxAttempts: TrackPlayerDashScopeTTSPlayer.MAX_CHUNK_FETCH_RETRIES + 1,
          error,
        });
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    throw lastError instanceof Error ? lastError : new Error("DashScope TTS chunk fetch failed");
  }

  private _notifyChunkChange(index: number): void {
    if (!Number.isFinite(index) || index < 0 || index >= this._chunks.length) return;
    if (index === this._lastNotifiedIndex) return;
    this._lastNotifiedIndex = index;
    this._currentIndex = index;
    this.onChunkChange?.(index, this._chunks.length);
  }

  private _syncActiveTrackFromNative(gen: number): void {
    void (async () => {
      try {
        const [activeTrack, playbackState] = await Promise.all([
          TrackPlayer.getActiveTrack().catch(() => null),
          TrackPlayer.getPlaybackState().catch(() => null),
        ]);
        if (gen !== this._speakGen || this._stopped) return;

        const chunkIndex = chunkIndexFromTrackId(activeTrack?.id);
        if (chunkIndex != null) {
          this._notifyChunkChange(chunkIndex);
        }

        if (this._paused) {
          if (playbackState?.state === State.Playing) {
            await TrackPlayer.pause().catch((err) =>
              console.warn("[TTS] TrackPlayer pause failed:", err),
            );
          }
          this.onStateChange?.("paused");
        } else if (playbackState?.state === State.Playing) {
          this._playStarted = true;
          this._startProgressPolling(gen);
          this.onStateChange?.("playing");
        } else if (playbackState?.state === State.Ended || playbackState?.state === State.Stopped) {
          this._handlePlaybackEnded(gen, chunkIndex ?? undefined);
        }
      } catch (error) {
        console.warn("[TrackPlayerDashScopeTTSPlayer] failed to sync active track", error);
      }
    })();
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

    try {
      const [activeTrack, playbackState] = await Promise.all([
        TrackPlayer.getActiveTrack().catch(() => null),
        TrackPlayer.getPlaybackState().catch(() => null),
      ]);

      if (gen !== this._speakGen || this._stopped) return;

      const chunkIndex = chunkIndexFromTrackId(activeTrack?.id);
      if (chunkIndex != null) {
        this._notifyChunkChange(chunkIndex);
      }

      if (playbackState?.state === State.Ended || playbackState?.state === State.Stopped) {
        this._handlePlaybackEnded(gen, chunkIndex ?? undefined);
        return;
      }

      if (
        !this._downloadComplete ||
        this._paused ||
        chunkIndex == null ||
        !this._isAtFinalTrack(chunkIndex)
      )
        return;

      const progress = await TrackPlayer.getProgress().catch(() => null);
      if (gen !== this._speakGen || this._stopped || !progress) return;
      const remaining = progress.duration - progress.position;
      if (progress.duration > 0 && progress.position > 0 && remaining <= 0.35) {
        this._finishPlayback();
      }
    } catch {}
  }

  private _handlePlaybackEnded(gen: number, track?: number): void {
    if (gen !== this._speakGen || this._stopped) return;

    const endedIndex = typeof track === "number" ? track : this._currentIndex;
    if (this._downloadComplete && this._isAtFinalTrack(endedIndex)) {
      this._finishPlayback();
      return;
    }

    console.warn("[TrackPlayerDashScopeTTSPlayer] playback ended before final chunk", {
      track,
      currentIndex: this._currentIndex,
      endedIndex,
      nextChunkToAdd: this._nextChunkToAdd,
      total: this._chunks.length,
      downloadComplete: this._downloadComplete,
    });
    this._markQueueStarved(track);
    if (this._hasEnoughQueuedToResume()) {
      void this._resumeStarvedQueue(gen);
    }
  }

  private _markQueueStarved(track?: number): void {
    this._queueStarved = true;
    // Don't bump _currentIndex to lastQueuedIndex when track is unknown —
    // see edge-player for why (caused _resumeStarvedQueue to skip past
    // unplayed chunks once the producer caught up).
    if (typeof track === "number") {
      this._currentIndex = Math.max(this._currentIndex, track);
    }
    console.warn(
      "[TrackPlayerDashScopeTTSPlayer] queue starved, waiting for next generated chunk",
      {
        track,
        currentIndex: this._currentIndex,
        nextChunkToAdd: this._nextChunkToAdd,
        total: this._chunks.length,
      },
    );

    // On iOS, keep the audio session alive by inserting a silent track.
    if (Platform.OS === "ios") {
      void this._insertSilenceKeepAlive();
    }
  }

  private async _insertSilenceKeepAlive(): Promise<void> {
    try {
      const silenceUri = ensureSilenceFile();
      const silenceId = `tts-silence-${Date.now()}`;
      this._silenceTrackIds.add(silenceId);
      await TrackPlayer.add({
        id: silenceId,
        url: silenceUri,
        title: "Buffering…",
        artwork: this._currentArtwork,
        duration: 1,
      });
      const state = await TrackPlayer.getPlaybackState().catch(() => null);
      if (state?.state !== State.Playing && !this._paused && !this._stopped) {
        await TrackPlayer.play();
      }
    } catch (error) {
      console.warn("[TrackPlayerDashScopeTTSPlayer] failed to insert silence keep-alive", error);
    }
  }

  /**
   * Called when app returns to foreground after being suspended.
   * Restarts the producer and attempts to resume playback if queue was starved.
   */
  private _recoverFromStarvation(gen: number): void {
    if (gen !== this._speakGen || this._stopped) return;
    console.log("[TrackPlayerDashScopeTTSPlayer] recovering from background starvation");
    this._ensureProducerRunning(gen);
  }

  private _isAtFinalTrack(index = this._currentIndex): boolean {
    return this._downloadComplete && index >= this._chunks.length - 1;
  }

  private _finishPlayback(): void {
    if (this._stopped) return;
    this._stopped = true;
    this._paused = false;
    this._queueStarved = false;
    this._stopProgressPolling();
    this.onStateChange?.("stopped");
    this.onEnd?.();
  }

  private async _fetchChunkFile(index: number, gen: number): Promise<string> {
    if (this._stopped || gen !== this._speakGen || !this._config) throw new Error("aborted");

    const config = this._config;
    const platform = getPlatformService();

    const response = await platform.fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.dashscopeApiKey}`,
        },
        body: JSON.stringify({
          model: "qwen3-tts-flash",
          input: {
            text: this._chunks[index],
            voice: config.dashscopeVoice,
          },
          parameters: {
            response_format: "mp3",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`DashScope TTS failed: ${response.status}`);
    }

    const result = (await response.json()) as {
      output?: { audio?: { data?: string } };
    };
    const audioData = result?.output?.audio?.data;
    if (!audioData) {
      throw new Error("No audio data in DashScope response");
    }

    if (this._stopped || gen !== this._speakGen) throw new Error("aborted");

    const binary = atob(audioData);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) {
      bytes[j] = binary.charCodeAt(j);
    }

    const tmpName = `tts_dashscope_${index}_${Date.now()}.mp3`;
    const tmpFile = new File(Paths.cache, tmpName);
    const audioUri = tmpFile.uri;
    this._tempFiles.push(audioUri);
    tmpFile.write(bytes);
    return audioUri;
  }

  pause(): void {
    if (this._stopped || this._paused) return;
    this._paused = true;
    this._stopProgressPolling();
    TrackPlayer.pause();
    this.onStateChange?.("paused");
  }

  resume(): void {
    if (this._stopped || !this._paused) return;
    this._paused = false;
    TrackPlayer.play();
    this._playStarted = true;
    this._startProgressPolling(this._speakGen);
    this.onStateChange?.("playing");
  }

  stop(): void {
    this._stopped = true;
    this._paused = false;
    this._downloadComplete = false;
    this._queueStarved = false;
    this._playStarted = false;
    this._nextChunkToFetch = 0;
    this._producerRunning = false;
    this._fetchPromises.clear();
    this._silenceTrackIds.clear();
    this._stopProgressPolling();
    TrackPlayer.stop();
    TrackPlayer.reset();
    this._cleanupEvents();
    this._cleanupTempFiles();
    this.onStateChange?.("stopped");
  }

  private async _cleanup(): Promise<void> {
    this._stopped = true;
    this._downloadComplete = false;
    this._queueStarved = false;
    this._playStarted = false;
    this._nextChunkToFetch = 0;
    this._producerRunning = false;
    this._fetchPromises.clear();
    this._silenceTrackIds.clear();
    this._stopProgressPolling();
    this._cleanupEvents();
    try {
      await TrackPlayer.stop();
      await TrackPlayer.reset();
    } catch (err) {
      console.warn("[TTS] TrackPlayer stop/reset failed during cleanup:", err);
    }
    this._cleanupTempFiles();
  }

  private _cleanupEvents(): void {
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }

  private _cleanupTempFiles(): void {
    for (const f of this._tempFiles) {
      try {
        const file = new File(f);
        if (file.exists) file.delete();
      } catch {}
    }
    this._tempFiles = [];
  }
}
