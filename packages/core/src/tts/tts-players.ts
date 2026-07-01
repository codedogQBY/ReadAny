/**
 * TTS Players — three engine implementations, all platform-agnostic.
 *
 * 1. BrowserTTSPlayer — SpeechSynthesis API (available in all WebViews)
 * 2. DashScopeTTSPlayer — Alibaba Cloud qwen3-tts-flash via SSE streaming
 * 3. EdgeTTSPlayer — Microsoft Neural voices via WebSocket, gapless AudioContext playback
 */

import { getPlatformService } from "../services/platform";
import { fetchEdgeTTSAudio } from "./edge-tts";
import { type ChunkBoundary, resolveCurrentChunk } from "./playback-cursor";
import { splitIntoChunks } from "./text-utils";
import type { ITTSPlayer, TTSConfig } from "./types";

// ── Browser SpeechSynthesis ──

export class BrowserTTSPlayer implements ITTSPlayer {
  private chunks: string[] = [];
  private currentIndex = 0;
  private _speaking = false;
  private _paused = false;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  get speaking() {
    return this._speaking;
  }
  get paused() {
    return this._paused;
  }

  speak(text: string | string[], config: TTSConfig) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      console.warn("[TTS] SpeechSynthesis not available on this platform");
      return;
    }
    this.stop();
    this.chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text);
    this.currentIndex = 0;
    this._speaking = true;
    this._paused = false;
    this.onStateChange?.("playing");
    this.speakChunk(config);
  }

  private speakChunk(config: TTSConfig) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (this.currentIndex >= this.chunks.length) {
      const onEnd = this.onEnd;
      this._speaking = false;
      this._paused = false;
      window.speechSynthesis.cancel();
      this.chunks = [];
      this.currentIndex = 0;
      this.onStateChange?.("stopped");
      onEnd?.();
      return;
    }

    const synth = window.speechSynthesis;
    const utt = new SpeechSynthesisUtterance(this.chunks[this.currentIndex]);
    utt.rate = config.rate;
    utt.pitch = config.pitch;

    if (config.voiceName) {
      const voice = synth
        .getVoices()
        .find((v) => v.voiceURI === config.voiceName || v.name === config.voiceName);
      if (voice) utt.voice = voice;
    }

    utt.onstart = () => {
      this.onChunkChange?.(this.currentIndex, this.chunks.length);
    };

    utt.onend = () => {
      this.currentIndex++;
      if (this._speaking && !this._paused) {
        this.speakChunk(config);
      }
    };

    utt.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;
      console.error("[TTS] SpeechSynthesis error:", e.error);
      this.currentIndex++;
      if (this._speaking) this.speakChunk(config);
    };
    synth.speak(utt);
  }

  pause() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (!this._speaking || this._paused) return;
    window.speechSynthesis.pause();
    this._paused = true;
    this.onStateChange?.("paused");
  }

  resume() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (!this._speaking || !this._paused) return;
    window.speechSynthesis.resume();
    this._paused = false;
    this.onStateChange?.("playing");
  }

  stop() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.chunks = [];
    this.currentIndex = 0;
    this._speaking = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }
}

// ── DashScope TTS (Alibaba Cloud qwen3-tts-flash) — Real-time Streaming ──

export class DashScopeTTSPlayer implements ITTSPlayer {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledEnd = 0;
  private _playing = false;
  private _paused = false;
  private allChunksDone = false;
  private hasAudioData = false;
  private abortController: AbortController | null = null;
  private checkEndTimer: ReturnType<typeof setInterval> | null = null;
  private pendingBytes: Uint8Array[] = [];
  private decodeTimeout: ReturnType<typeof setTimeout> | null = null;
  private chunkBoundaries: ChunkBoundary[] = [];
  private totalChunks = 0;
  private currentStreamIndex = 0;
  private boundaryRecorded = false;
  private lastNotifiedChunkIndex = -1;
  private runId = 0;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  get playing() {
    return this._playing;
  }
  get paused() {
    return this._paused;
  }

  async speak(text: string | string[], config: TTSConfig) {
    this.abortController?.abort();
    this.abortController = null;
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    if (this.decodeTimeout) {
      clearTimeout(this.decodeTimeout);
      this.decodeTimeout = null;
    }
    this.cleanupAudio();
    this.pendingBytes = [];

    const chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text);
    const myRun = ++this.runId;
    this._playing = true;
    this._paused = false;
    this.allChunksDone = false;
    this.hasAudioData = false;
    this.totalChunks = chunks.length;
    this.chunkBoundaries = [];
    this.lastNotifiedChunkIndex = -1;

    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    this.checkEndTimer = setInterval(() => {
      if (!this._playing) return;
      if (this.audioCtx) {
        const current = resolveCurrentChunk(this.chunkBoundaries, this.audioCtx.currentTime);
        if (current >= 0 && current !== this.lastNotifiedChunkIndex) {
          this.lastNotifiedChunkIndex = current;
          this.onChunkChange?.(current, this.totalChunks);
        }
      }
      if (
        this.allChunksDone &&
        this.audioCtx &&
        this.pendingBytes.length === 0 &&
        !this.decodeTimeout
      ) {
        if (!this.hasAudioData) {
          this.finishPlayback();
          return;
        }
        const currentTime = this.audioCtx.currentTime;
        if (currentTime >= this.scheduledEnd - 0.05) {
          this.finishPlayback();
        }
      }
    }, 200);

    for (let i = 0; i < chunks.length; i++) {
      if (!this._playing || myRun !== this.runId) return;
      this.currentStreamIndex = i;
      this.boundaryRecorded = false;
      try {
        await this.streamChunk(chunks[i], config, i === 0, myRun);
      } catch (err) {
        console.error("[DashScope TTS] chunk error:", err);
      }
    }

    if (myRun !== this.runId) return;
    this.flushPendingBytes();
    this.allChunksDone = true;
  }

  private async streamChunk(
    text: string,
    config: TTSConfig,
    isFirst: boolean,
    myRun: number,
  ): Promise<void> {
    const platform = getPlatformService();
    this.abortController = new AbortController();
    this.pendingBytes = [];

    const response = await platform.fetch(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.dashscopeApiKey}`,
          "X-DashScope-SSE": "enable",
        },
        body: JSON.stringify({
          model: "qwen3-tts-flash",
          input: {
            text,
            voice: config.dashscopeVoice,
          },
        }),
        signal: this.abortController.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`DashScope TTS failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body reader");

    const decoder = new TextDecoder();
    let buffer = "";
    let firstAudioReceived = false;

    while (true) {
      if (!this._playing || myRun !== this.runId) {
        reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!this._playing || myRun !== this.runId) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const evt = JSON.parse(jsonStr);
          const audioData = evt?.output?.audio?.data;
          if (audioData && this.audioCtx) {
            const binary = atob(audioData);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) {
              bytes[j] = binary.charCodeAt(j);
            }
            this.pendingBytes.push(bytes);

            if (!firstAudioReceived) {
              firstAudioReceived = true;
              if (isFirst) {
                this.onStateChange?.("playing");
              }
            }

            this.scheduleFlush();
          }
        } catch (err) {
          console.warn("[TTS] Failed to parse DashScope stream JSON:", err);
        }
      }
    }

    if (myRun !== this.runId) return;
    this.flushPendingBytes();
  }

  private scheduleFlush() {
    if (this.decodeTimeout) return;
    this.decodeTimeout = setTimeout(() => {
      this.decodeTimeout = null;
      this.flushPendingBytes();
    }, 100);
  }

  private flushPendingBytes() {
    if (this.decodeTimeout) {
      clearTimeout(this.decodeTimeout);
      this.decodeTimeout = null;
    }
    if (this.pendingBytes.length === 0 || !this.audioCtx || !this.gainNode) return;

    const totalLen = this.pendingBytes.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (const chunk of this.pendingBytes) {
      merged.set(chunk, off);
      off += chunk.length;
    }
    this.pendingBytes = [];

    const PCM_SAMPLE_RATE = 24000;
    const numSamples = Math.floor(merged.length / 2);
    if (numSamples === 0) return;

    const ctx = this.audioCtx;
    const gain = this.gainNode;
    const audioBuffer = ctx.createBuffer(1, numSamples, PCM_SAMPLE_RATE);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);

    for (let i = 0; i < numSamples; i++) {
      const sample = view.getInt16(i * 2, true);
      channelData[i] = sample / 32768;
    }

    if (!this._playing) return;
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);

    const startAt = Math.max(ctx.currentTime, this.scheduledEnd);
    source.start(startAt);
    this.scheduledEnd = startAt + audioBuffer.duration;
    this.hasAudioData = true;

    if (!this.boundaryRecorded) {
      this.chunkBoundaries.push({ index: this.currentStreamIndex, startAt });
      this.boundaryRecorded = true;
    }
  }

  private finishPlayback() {
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    const onEnd = this.onEnd;
    this.cleanupAudio();
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
    onEnd?.();
  }

  pause() {
    if (!this._playing || this._paused) return;
    this.audioCtx?.suspend();
    this._paused = true;
    this.onStateChange?.("paused");
  }

  resume() {
    if (!this._playing || !this._paused) return;
    this.audioCtx?.resume();
    this._paused = false;
    this.onStateChange?.("playing");
  }

  stop() {
    this.abortController?.abort();
    this.abortController = null;
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    if (this.decodeTimeout) {
      clearTimeout(this.decodeTimeout);
      this.decodeTimeout = null;
    }
    this.cleanupAudio();
    this.pendingBytes = [];
    this.allChunksDone = false;
    this.hasAudioData = false;
    this.chunkBoundaries = [];
    this.lastNotifiedChunkIndex = -1;
    this.boundaryRecorded = false;
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }

  private cleanupAudio() {
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.gainNode = null;
    this.scheduledEnd = 0;
  }
}

// ── Edge TTS (Microsoft Neural voices — free, high quality) ──

export class EdgeTTSPlayer implements ITTSPlayer {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledEnd = 0;
  private chunks: string[] = [];
  private _playing = false;
  private _paused = false;
  private hasAudioData = false;
  private playingNotified = false;
  private checkEndTimer: ReturnType<typeof setInterval> | null = null;
  private allChunksDone = false;
  private fetchBuffer = new Map<number, Promise<ArrayBuffer>>();
  private producerIndex = 0;
  private producerWake: (() => void) | null = null;
  private chunkStartTimers = new Set<ReturnType<typeof setTimeout>>();
  private activeSources = new Set<AudioBufferSourceNode>();
  private pausedAt = 0; // Date.now() when suspended (wall-clock ms)
  /** Monotonic per-run token, bumped on every speak() to invalidate the previous
   *  run's in-flight async continuations (mirrors DashScopeTTSPlayer). */
  private runId = 0;
  private static readonly BUFFER_SIZE = 4;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  get playing() {
    return this._playing;
  }
  get paused() {
    return this._paused;
  }

  /** Clear the producer's wake resolver. Extracted into a method so callers'
   *  control-flow analysis keeps producerWake's declared (() => void) | null
   *  type — runProducer reassigns it across an un-awaited call TS can't track. */
  private resetProducerWake() {
    this.producerWake = null;
  }

  async speak(text: string | string[], config: TTSConfig) {
    // Invalidate any in-flight run immediately: its captured myRun no longer
    // equals this.runId, so every continuation/timer below bails on its guard.
    const myRun = ++this.runId;
    this.cleanupAudio();
    this.fetchBuffer.clear();
    this.producerWake?.();
    this.resetProducerWake();
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }

    this.chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text, 800);
    this._playing = true;
    this._paused = false;
    this.allChunksDone = false;
    this.hasAudioData = false;
    this.playingNotified = false;
    this.pausedAt = 0;

    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    if (this.audioCtx.state === "suspended") {
      // 重入下（同步 stop()+speak()）后继 run 可能在此 await 期间 close 掉本 ctx，
      // 使 resume() reject；吞掉它——下方的 myRun !== this.runId 守卫本就会丢弃本 run。
      await this.audioCtx.resume().catch(() => {});
    }
    // A newer run may have superseded us during the resume() await.
    if (myRun !== this.runId) return;

    this.checkEndTimer = setInterval(() => {
      if (myRun !== this.runId) return;
      if (!this._playing || this._paused) return;
      // Also guard against the AudioContext being auto-suspended by the OS
      // (e.g. iOS background / lock-screen) without us explicitly pausing.
      if (this.audioCtx?.state === "suspended") return;
      if (this.allChunksDone && this.audioCtx) {
        if (!this.hasAudioData) {
          this.finishPlayback();
          return;
        }
        const currentTime = this.audioCtx.currentTime;
        if (currentTime >= this.scheduledEnd - 0.05) {
          this.finishPlayback();
        }
      }
    }, 200);

    const voice = config.edgeVoice || "zh-CN-XiaoxiaoNeural";
    const lang = voice.split("-").slice(0, 2).join("-");
    const base = { voice, lang, rate: config.rate, pitch: config.pitch };

    this.producerIndex = 0;
    this.fetchBuffer.clear();

    this.runProducer(base, myRun);

    const prewarmCount = Math.min(EdgeTTSPlayer.BUFFER_SIZE, this.chunks.length);
    for (let p = 0; p < prewarmCount; p++) {
      if (this.fetchBuffer.has(p)) continue;
      if (!this._playing || myRun !== this.runId) return;
      const promise = fetchEdgeTTSAudio({ text: this.chunks[p], ...base });
      promise.catch(() => {});
      this.fetchBuffer.set(p, promise);
      this.producerIndex = p + 1;
    }

    for (let i = 0; i < this.chunks.length; i++) {
      if (!this._playing || myRun !== this.runId) return;
      try {
        const audioData = await this.waitForChunk(i, myRun);
        if (!this._playing || myRun !== this.runId) return;
        await this.decodeAndSchedule(audioData, i, myRun);
        // Old run resuming here must not delete/wake the new run's buffer.
        if (!this._playing || myRun !== this.runId) return;
      } catch (err) {
        if (myRun !== this.runId) return;
        if ((err as Error)?.message === "aborted") return;
        console.error("[Edge TTS] chunk error:", err);
      }

      this.fetchBuffer.delete(i);
      this.producerWake?.();
    }

    if (myRun !== this.runId) return;
    this.allChunksDone = true;
  }

  private async runProducer(
    base: { voice: string; lang: string; rate: number; pitch: number },
    myRun: number,
  ) {
    while (this.producerIndex < this.chunks.length) {
      if (!this._playing || myRun !== this.runId) return;

      while (this.fetchBuffer.size >= EdgeTTSPlayer.BUFFER_SIZE) {
        if (!this._playing || myRun !== this.runId) return;
        await new Promise<void>((resolve) => {
          this.producerWake = resolve;
        });
        // Old producer resuming here must not clobber the new run's producerWake.
        if (myRun !== this.runId) return;
        this.producerWake = null;
      }

      if (!this._playing || myRun !== this.runId) return;

      const idx = this.producerIndex++;
      const promise = fetchEdgeTTSAudio({ text: this.chunks[idx], ...base });
      promise.catch(() => {});
      this.fetchBuffer.set(idx, promise);
    }
  }

  private async waitForChunk(index: number, myRun: number): Promise<ArrayBuffer> {
    while (!this.fetchBuffer.has(index)) {
      if (!this._playing || myRun !== this.runId) {
        throw new Error("aborted");
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    const chunk = this.fetchBuffer.get(index);
    if (!chunk) throw new Error("aborted");
    return chunk;
  }

  private async decodeAndSchedule(
    mp3Data: ArrayBuffer,
    index: number,
    myRun: number,
  ): Promise<void> {
    const ctx = this.audioCtx;
    const gain = this.gainNode;
    if (!ctx || !gain || !this._playing || myRun !== this.runId) return;

    const audioBuffer = await ctx.decodeAudioData(mp3Data.slice(0));
    // Bail if superseded, or if a new run swapped in a different AudioContext —
    // never schedule into a ctx that isn't this run's.
    if (!this._playing || myRun !== this.runId || this.audioCtx !== ctx || !this.gainNode) return;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gain);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };

    const startAt = Math.max(ctx.currentTime, this.scheduledEnd);
    const notifyChunkStart = () => {
      if (!this._playing || myRun !== this.runId) return;
      this.onChunkChange?.(index, this.chunks.length);
    };
    const startDelayMs = Math.max(0, (startAt - ctx.currentTime) * 1000);
    if (startDelayMs <= 16) {
      notifyChunkStart();
    } else {
      const timer = setTimeout(() => {
        this.chunkStartTimers.delete(timer);
        notifyChunkStart();
      }, startDelayMs);
      this.chunkStartTimers.add(timer);
    }
    source.start(startAt);
    this.scheduledEnd = startAt + audioBuffer.duration;
    this.hasAudioData = true;

    if (!this.playingNotified) {
      this.playingNotified = true;
      this.onStateChange?.("playing");
    }
  }

  private finishPlayback() {
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    const onEnd = this.onEnd;
    this.cleanupAudio();
    this.fetchBuffer.clear();
    this.producerWake?.();
    this.chunks = [];
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
    onEnd?.();
  }

  pause() {
    if (!this._playing || this._paused) return;
    this.pausedAt = Date.now();
    this.audioCtx?.suspend();
    for (const timer of this.chunkStartTimers) clearTimeout(timer);
    this.chunkStartTimers.clear();
    this._paused = true;
    this.onStateChange?.("paused");
  }

  resume() {
    if (!this._playing || !this._paused) return;
    // audioCtx.currentTime is frozen while suspended; shift scheduledEnd forward
    // by however long we were paused (wall-clock) so checkEndTimer doesn't fire early.
    if (this.pausedAt > 0) {
      const pausedSeconds = (Date.now() - this.pausedAt) / 1000;
      this.scheduledEnd += pausedSeconds;
    }
    this.pausedAt = 0;
    this.audioCtx?.resume();
    this._paused = false;
    this.onStateChange?.("playing");
  }

  stop() {
    this.runId += 1;
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    this.cleanupAudio();
    this.fetchBuffer.clear();
    this.producerWake?.();
    this.producerWake = null;
    this.chunks = [];
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }

  private cleanupAudio() {
    for (const timer of this.chunkStartTimers) clearTimeout(timer);
    this.chunkStartTimers.clear();
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      try {
        source.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.activeSources.clear();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.gainNode = null;
    this.scheduledEnd = 0;
  }
}
