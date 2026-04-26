/**
 * TTS Players — engine implementations, all platform-agnostic.
 *
 * 1. BrowserTTSPlayer — SpeechSynthesis API (available in all WebViews)
 * 2. DashScopeTTSPlayer — Alibaba Cloud qwen3-tts-flash via SSE streaming
 * 3. EdgeTTSPlayer — Microsoft Neural voices via WebSocket, gapless AudioContext playback
 * 4. MiMoTTSPlayer — Xiaomi MiMo-V2.5-TTS via OpenAI-style chat completions
 */

import { getPlatformService } from "../services/platform";
import { fetchEdgeTTSAudio } from "./edge-tts";
import { splitIntoChunks } from "./text-utils";
import type { ITTSPlayer, TTSConfig } from "./types";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

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

// ── Xiaomi MiMo TTS (MiMo-V2.5-TTS — non-streaming base64 audio) ──

export class MiMoTTSPlayer implements ITTSPlayer {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledEnd = 0;
  private chunks: string[] = [];
  private _playing = false;
  private _paused = false;
  private aborted = false;
  private hasAudioData = false;
  private allChunksDone = false;
  private playingNotified = false;
  private checkEndTimer: ReturnType<typeof setInterval> | null = null;
  private chunkStartTimers = new Set<ReturnType<typeof setTimeout>>();
  private abortController: AbortController | null = null;
  private pausedAt = 0;

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
    this.aborted = true;
    this.abortController?.abort();
    this.abortController = null;
    this.cleanupAudio();
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }

    this.chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text, 800);
    this._playing = true;
    this._paused = false;
    this.aborted = false;
    this.hasAudioData = false;
    this.allChunksDone = false;
    this.playingNotified = false;
    this.pausedAt = 0;

    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    this.checkEndTimer = setInterval(() => {
      if (!this._playing || this._paused) return;
      if (this.audioCtx?.state === "suspended") return;
      if (!this.audioCtx) return;
      if (!this.allChunksDone || !this.hasAudioData) return;
      if (this.audioCtx.currentTime >= this.scheduledEnd - 0.05) {
        this.finishPlayback();
      }
    }, 200);

    for (let i = 0; i < this.chunks.length; i++) {
      if (!this._playing || this.aborted) return;
      try {
        const audioData = await this.fetchChunkAudio(this.chunks[i], config);
        if (!this._playing || this.aborted) return;
        await this.decodeAndSchedule(audioData, i);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        console.error("[MiMo TTS] chunk error:", err);
      }
    }

    this.allChunksDone = true;
  }

  private async fetchChunkAudio(text: string, config: TTSConfig): Promise<ArrayBuffer> {
    const platform = getPlatformService();
    this.abortController = new AbortController();

    const response = await platform.fetch("https://api.xiaomimimo.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.mimoApiKey,
      },
      body: JSON.stringify({
        model: config.mimoModel || "mimo-v2.5-tts",
        messages: [
          {
            role: "assistant",
            content: text,
          },
        ],
        audio: {
          format: config.mimoFormat || "wav",
          voice: config.mimoVoice || "mimo_default",
        },
      }),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`MiMo TTS failed: ${response.status}${errorText ? ` ${errorText}` : ""}`);
    }

    const result = await response.json();
    const audioData = result?.choices?.[0]?.message?.audio?.data;
    if (typeof audioData !== "string" || !audioData) {
      throw new Error("No audio data received from MiMo TTS.");
    }

    return base64ToArrayBuffer(audioData);
  }

  private async decodeAndSchedule(audioData: ArrayBuffer, index: number): Promise<void> {
    if (!this.audioCtx || !this.gainNode || !this._playing || this.aborted) return;

    const audioBuffer = await this.audioCtx.decodeAudioData(audioData.slice(0));
    if (!this.audioCtx || !this.gainNode || !this._playing || this.aborted) return;

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const startAt = Math.max(this.audioCtx.currentTime, this.scheduledEnd);
    const notifyChunkStart = () => {
      if (!this._playing || this.aborted) return;
      this.onChunkChange?.(index, this.chunks.length);
    };
    const startDelayMs = Math.max(0, (startAt - this.audioCtx.currentTime) * 1000);
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
    this.chunks = [];
    this.allChunksDone = false;
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
    if (this.pausedAt > 0) {
      this.scheduledEnd += (Date.now() - this.pausedAt) / 1000;
    }
    this.pausedAt = 0;
    this.audioCtx?.resume();
    this._paused = false;
    this.onStateChange?.("playing");
  }

  stop() {
    this.aborted = true;
    this.abortController?.abort();
    this.abortController = null;
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    this.cleanupAudio();
    this.chunks = [];
    this.allChunksDone = false;
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }

  private cleanupAudio() {
    for (const timer of this.chunkStartTimers) clearTimeout(timer);
    this.chunkStartTimers.clear();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.gainNode = null;
    this.scheduledEnd = 0;
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
    this._playing = true;
    this._paused = false;
    this.allChunksDone = false;
    this.hasAudioData = false;

    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    this.checkEndTimer = setInterval(() => {
      if (!this._playing) return;
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
      if (!this._playing) return;
      this.onChunkChange?.(i, chunks.length);
      try {
        await this.streamChunk(chunks[i], config, i === 0);
      } catch (err) {
        console.error("[DashScope TTS] chunk error:", err);
      }
    }

    this.flushPendingBytes();
    this.allChunksDone = true;
  }

  private async streamChunk(text: string, config: TTSConfig, isFirst: boolean): Promise<void> {
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
      if (!this._playing) {
        reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;

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
        } catch {
          // skip malformed JSON
        }
      }
    }

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
  private aborted = false;
  private hasAudioData = false;
  private playingNotified = false;
  private checkEndTimer: ReturnType<typeof setInterval> | null = null;
  private allChunksDone = false;
  private fetchBuffer = new Map<number, Promise<ArrayBuffer>>();
  private producerIndex = 0;
  private producerWake: (() => void) | null = null;
  private chunkStartTimers = new Set<ReturnType<typeof setTimeout>>();
  private pausedAt = 0; // Date.now() when suspended (wall-clock ms)
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

  async speak(text: string | string[], config: TTSConfig) {
    this.aborted = true;
    this.cleanupAudio();
    this.fetchBuffer.clear();
    this.producerWake?.();
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }

    this.chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text, 800);
    this._playing = true;
    this._paused = false;
    this.aborted = false;
    this.allChunksDone = false;
    this.hasAudioData = false;
    this.playingNotified = false;
    this.pausedAt = 0;

    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    this.checkEndTimer = setInterval(() => {
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

    this.runProducer(base);

    const prewarmCount = Math.min(EdgeTTSPlayer.BUFFER_SIZE, this.chunks.length);
    for (let p = 0; p < prewarmCount; p++) {
      if (this.fetchBuffer.has(p)) continue;
      if (!this._playing || this.aborted) return;
      const promise = fetchEdgeTTSAudio({ text: this.chunks[p], ...base });
      promise.catch(() => {});
      this.fetchBuffer.set(p, promise);
      this.producerIndex = p + 1;
    }

    for (let i = 0; i < this.chunks.length; i++) {
      if (!this._playing || this.aborted) return;
      try {
        const audioData = await this.waitForChunk(i);
        if (!this._playing || this.aborted) return;
        await this.decodeAndSchedule(audioData, i);
      } catch (err) {
        if ((err as Error)?.message === "aborted") return;
        console.error("[Edge TTS] chunk error:", err);
      }

      this.fetchBuffer.delete(i);
      this.producerWake?.();
    }

    this.allChunksDone = true;
  }

  private async runProducer(base: { voice: string; lang: string; rate: number; pitch: number }) {
    while (this.producerIndex < this.chunks.length) {
      if (!this._playing || this.aborted) return;

      while (this.fetchBuffer.size >= EdgeTTSPlayer.BUFFER_SIZE) {
        if (!this._playing || this.aborted) return;
        await new Promise<void>((resolve) => {
          this.producerWake = resolve;
        });
        this.producerWake = null;
      }

      if (!this._playing || this.aborted) return;

      const idx = this.producerIndex++;
      const promise = fetchEdgeTTSAudio({ text: this.chunks[idx], ...base });
      promise.catch(() => {});
      this.fetchBuffer.set(idx, promise);
    }
  }

  private async waitForChunk(index: number): Promise<ArrayBuffer> {
    while (!this.fetchBuffer.has(index)) {
      if (!this._playing || this.aborted) {
        throw new Error("aborted");
      }
      await new Promise<void>((r) => setTimeout(r, 50));
    }
    return this.fetchBuffer.get(index)!;
  }

  private async decodeAndSchedule(mp3Data: ArrayBuffer, index: number): Promise<void> {
    if (!this.audioCtx || !this.gainNode || !this._playing || this.aborted) return;

    const audioBuffer = await this.audioCtx.decodeAudioData(mp3Data.slice(0));
    if (!this._playing || this.aborted || !this.audioCtx || !this.gainNode) return;

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const startAt = Math.max(this.audioCtx.currentTime, this.scheduledEnd);
    const notifyChunkStart = () => {
      if (!this._playing || this.aborted) return;
      this.onChunkChange?.(index, this.chunks.length);
    };
    const startDelayMs = Math.max(0, (startAt - this.audioCtx.currentTime) * 1000);
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
    this.aborted = true;
    if (this.checkEndTimer) {
      clearInterval(this.checkEndTimer);
      this.checkEndTimer = null;
    }
    this.cleanupAudio();
    this.fetchBuffer.clear();
    this.producerWake?.();
    this.chunks = [];
    this._playing = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }

  private cleanupAudio() {
    for (const timer of this.chunkStartTimers) clearTimeout(timer);
    this.chunkStartTimers.clear();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.gainNode = null;
    this.scheduledEnd = 0;
  }
}
