import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
import { fetchEdgeTTSAudio } from "@readany/core/tts";
import { splitIntoChunks } from "@readany/core/tts";
/**
 * ExpoAVEdgeTTSPlayer — ITTSPlayer backed by expo-av + Edge TTS WebSocket API.
 *
 * Fetch MP3 chunks from Microsoft Edge TTS → write to temp files → play
 * sequentially via expo-av Audio.Sound with background audio enabled.
 *
 * Pipeline: while chunk N is playing, chunk N+1's Sound is pre-created
 * in background so there is zero gap between chunks.
 *
 * Background audio is enabled via Audio.setAudioModeAsync called at app
 * startup (see App.tsx). This player just manages playback.
 */
import { Audio } from "expo-av";
import { File, Paths } from "expo-file-system";

const CHUNK_MAX_CHARS = 500;

interface PrefetchedSound {
  sound: Audio.Sound;
  uri: string;
}

export class ExpoAVEdgeTTSPlayer implements ITTSPlayer {
  private static readonly BUFFER_SIZE = 4;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  private _stopped = false;
  private _paused = false;
  private _currentSound: Audio.Sound | null = null;
  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _config: TTSConfig | null = null;
  private _tempFiles: string[] = [];
  private _prefetchBuffer = new Map<number, Promise<string>>();
  private _producerIndex = 0;
  private _producerWake: (() => void) | null = null;
  private _nextSoundPromise: Promise<PrefetchedSound> | null = null;
  private _nextSoundIndex = -1;
  /** Incremented on every speak() call; lets _playChunk detect preemption. */
  private _speakGen = 0;

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    // Bump generation BEFORE cleanup so any in-flight _playChunk sees the new gen
    // immediately after their current await returns, and bails out.
    const gen = ++this._speakGen;
    await this._cleanup();
    // If another speak() arrived while we were cleaning up, abort this one.
    if (gen !== this._speakGen) return;
    this._stopped = false;
    this._paused = false;
    this._config = config;
    this._chunks = Array.isArray(text)
      ? text.filter(Boolean)
      : splitIntoChunks(text, CHUNK_MAX_CHARS);
    this._currentIndex = 0;
    this._tempFiles = [];
    this._prefetchBuffer.clear();
    this._producerIndex = 0;
    this._nextSoundPromise = null;
    this._nextSoundIndex = -1;
    this._runProducer();

    const prewarmCount = Math.min(ExpoAVEdgeTTSPlayer.BUFFER_SIZE, this._chunks.length);
    for (let p = 0; p < prewarmCount; p++) {
      if (this._prefetchBuffer.has(p)) continue;
      if (this._stopped) return;
      const promise = this._fetchChunkFile(p);
      promise.catch(() => {});
      this._prefetchBuffer.set(p, promise);
      this._producerIndex = p + 1;
    }

    this.onStateChange?.("playing");
    await this._playChunk(gen);
  }

  private async _playChunk(gen: number): Promise<void> {
    if (gen !== this._speakGen || this._stopped || this._currentIndex >= this._chunks.length) {
      if (gen === this._speakGen && !this._stopped) {
        this._stopped = true;
        console.log("[ExpoAVEdgeTTSPlayer] all chunks done, firing onEnd");
        this.onStateChange?.("stopped");
        this.onEnd?.();
      }
      return;
    }

    const idx = this._currentIndex;
    console.log(`[ExpoAVEdgeTTSPlayer] _playChunk start idx=${idx}/${this._chunks.length}`);
    this.onChunkChange?.(idx, this._chunks.length);

    let audioUri: string | null = null;
    let usedPrefetched = false;
    try {
      const hasNextPrefetched =
        this._nextSoundPromise !== null &&
        this._nextSoundIndex === idx &&
        idx < this._chunks.length;

      console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} hasNextPrefetched=${hasNextPrefetched}`);

      if (hasNextPrefetched) {
        console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} awaiting prefetched sound`);
        this._prefetchBuffer.delete(idx);
        this._producerWake?.();
        const prefetched = await this._nextSoundPromise!;
        this._nextSoundPromise = null;
        this._nextSoundIndex = -1;
        if (gen !== this._speakGen || this._stopped) {
          await prefetched.sound.unloadAsync().catch(() => {});
          return;
        }
        this._currentSound = prefetched.sound;
        audioUri = prefetched.uri;
        usedPrefetched = true;
      } else {
        console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} fetching file`);
        audioUri = await this._getChunkFile(idx);
        if (gen !== this._speakGen || this._stopped) return;
        console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} creating Sound`);
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: false, rate: 1.0, shouldCorrectPitch: false },
        );
        if (gen !== this._speakGen || this._stopped) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        this._currentSound = sound;
        console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} Sound created`);
      }

      const sound = this._currentSound!;

      this._prefetchNextSound(idx + 1);

      if (this._paused) {
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (gen !== this._speakGen || this._stopped) {
              clearInterval(checkInterval);
              resolve();
            } else if (!this._paused) {
              clearInterval(checkInterval);
              sound.playAsync().then(() => resolve());
            }
          }, 100);
        });
        if (gen !== this._speakGen || this._stopped) {
          await sound.unloadAsync().catch(() => {});
          this._currentSound = null;
          return;
        }
      }

      console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} registering status listener`);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const timeoutId = setTimeout(() => {
          console.warn(`[ExpoAVEdgeTTSPlayer] idx=${idx} playback timeout, advancing`);
          settle(resolve);
        }, 120_000);

        sound.setOnPlaybackStatusUpdate((status) => {
          // If preempted by a new speak(), resolve immediately so we can exit cleanly.
          if (gen !== this._speakGen) {
            clearTimeout(timeoutId);
            settle(resolve);
            return;
          }
          if (!status.isLoaded) {
            clearTimeout(timeoutId);
            if ((status as any).error) {
              console.error(
                `[ExpoAVEdgeTTSPlayer] idx=${idx} playback error:`,
                (status as any).error,
              );
              settle(() => reject(new Error((status as any).error)));
            } else {
              console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} isLoaded=false (natural end)`);
              settle(resolve);
            }
            return;
          }
          if (status.didJustFinish) {
            clearTimeout(timeoutId);
            console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} didJustFinish`);
            settle(resolve);
          }
        });

        if (!this._paused && !this._stopped && gen === this._speakGen) {
          console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} calling playAsync`);
          sound.playAsync().catch((err) => {
            console.error(`[ExpoAVEdgeTTSPlayer] idx=${idx} playAsync error:`, err);
            settle(() => reject(err));
          });
        }
      });

      console.log(`[ExpoAVEdgeTTSPlayer] idx=${idx} playback promise resolved, unloading`);
      await sound.unloadAsync().catch(() => {});
      this._currentSound = null;

      if (gen !== this._speakGen || this._stopped) return;
      this._currentIndex++;
      await this._playChunk(gen);
    } catch (err) {
      if (!this._stopped && (err as Error)?.message !== "aborted") {
        console.error(`[ExpoAVEdgeTTSPlayer] chunk ${idx} error:`, err);
      }
      if (this._currentSound) {
        await this._currentSound.unloadAsync().catch(() => {});
        this._currentSound = null;
      }
      if (gen !== this._speakGen || this._stopped) return;
      this._currentIndex++;
      await this._playChunk(gen);
    } finally {
      this._prefetchBuffer.delete(idx);
      this._producerWake?.();
      if (audioUri && !usedPrefetched) {
        try {
          const f = new File(audioUri);
          if (f.exists) f.delete();
        } catch {}
      }
    }
  }

  private _prefetchNextSound(idx: number): void {
    if (this._stopped || idx >= this._chunks.length) return;
    if (this._nextSoundPromise !== null) return;
    this._nextSoundIndex = idx;
    this._nextSoundPromise = (async () => {
      const uri = await this._getChunkFile(idx);
      if (this._stopped) throw new Error("aborted");
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, rate: 1.0, shouldCorrectPitch: false },
      );
      return { sound, uri };
    })().catch((err) => {
      if ((err as Error)?.message !== "aborted") {
        console.error("[ExpoAVEdgeTTSPlayer] prefetch error:", err);
      }
      throw err;
    });
  }

  pause(): void {
    if (this._stopped || this._paused) return;
    this._paused = true;
    this._currentSound?.pauseAsync().catch(() => {});
    this.onStateChange?.("paused");
  }

  resume(): void {
    if (this._stopped || !this._paused) return;
    this._paused = false;
    this._currentSound?.playAsync().catch(() => {});
    this.onStateChange?.("playing");
  }

  stop(): void {
    this._stopped = true;
    this._currentSound?.stopAsync().catch(() => {});
    this._currentSound?.unloadAsync().catch(() => {});
    this._currentSound = null;
    this._nextSoundPromise = null;
    this._nextSoundIndex = -1;
    this._prefetchBuffer.clear();
    this._producerWake?.();
    this._cleanupTempFiles();
    this.onStateChange?.("stopped");
  }

  private async _cleanup(): Promise<void> {
    this._stopped = true;
    if (this._currentSound) {
      await this._currentSound.stopAsync().catch(() => {});
      await this._currentSound.unloadAsync().catch(() => {});
      this._currentSound = null;
    }
    if (this._nextSoundPromise) {
      try {
        const prefetched = await this._nextSoundPromise;
        await prefetched.sound.unloadAsync().catch(() => {});
      } catch {}
      this._nextSoundPromise = null;
    }
    this._prefetchBuffer.clear();
    this._producerWake?.();
    this._cleanupTempFiles();
  }

  private async _runProducer(): Promise<void> {
    while (this._producerIndex < this._chunks.length) {
      if (this._stopped) return;

      while (this._prefetchBuffer.size >= ExpoAVEdgeTTSPlayer.BUFFER_SIZE) {
        if (this._stopped) return;
        await new Promise<void>((resolve) => {
          this._producerWake = resolve;
        });
        this._producerWake = null;
      }

      if (this._stopped) return;

      const index = this._producerIndex++;
      const promise = this._fetchChunkFile(index);
      promise.catch(() => {});
      this._prefetchBuffer.set(index, promise);
    }
  }

  private async _getChunkFile(index: number): Promise<string> {
    while (!this._prefetchBuffer.has(index)) {
      if (this._stopped) {
        throw new Error("aborted");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    const promise = this._prefetchBuffer.get(index);
    if (!promise) {
      return Promise.reject(new Error("aborted"));
    }
    return promise;
  }

  private async _fetchChunkFile(index: number): Promise<string> {
    if (this._stopped) throw new Error("aborted");
    const config = this._config!;
    const voice = config.edgeVoice || "zh-CN-XiaoxiaoNeural";
    const lang = voice.split("-").slice(0, 2).join("-");

    const mp3Data = await fetchEdgeTTSAudio({
      text: this._chunks[index],
      voice,
      lang,
      rate: config.rate,
      pitch: config.pitch,
    });

    if (this._stopped) throw new Error("aborted");

    const tmpName = `tts_chunk_${index}_${Date.now()}.mp3`;
    const tmpFile = new File(Paths.cache, tmpName);
    const audioUri = tmpFile.uri;
    this._tempFiles.push(audioUri);
    tmpFile.write(new Uint8Array(mp3Data));
    return audioUri;
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
