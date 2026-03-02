/**
 * TTS Service — Text-to-Speech using browser SpeechSynthesis API.
 *
 * Two playback modes:
 * 1. Foliate-integrated: uses foliate-js TTS module for paragraph-by-paragraph
 *    reading with word-level highlighting in the book view.
 * 2. Plain text: for reading selected text or chat messages.
 *
 * Also supports DashScope (Alibaba Cloud qwen3-tts-flash) as an optional
 * high-quality TTS backend when API key is configured.
 */

export type TTSEngine = "browser" | "dashscope";

export interface TTSConfig {
  engine: TTSEngine;
  /** Browser SpeechSynthesis voice name */
  voiceName: string;
  /** Speech rate (0.5 - 2.0) */
  rate: number;
  /** Speech pitch (0.5 - 2.0) */
  pitch: number;
  /** DashScope API Key (optional, for high-quality TTS) */
  dashscopeApiKey: string;
  /** DashScope voice (e.g. "Cherry", "Ethan") */
  dashscopeVoice: string;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  engine: "browser",
  voiceName: "",
  rate: 1.0,
  pitch: 1.0,
  dashscopeApiKey: "",
  dashscopeVoice: "Cherry",
};

export const DASHSCOPE_VOICES = [
  { id: "Cherry", label: "芊悦 (Cherry)" },
  { id: "Ethan", label: "晨煦 (Ethan)" },
  { id: "Nofish", label: "不吃鱼 (Nofish)" },
  { id: "Ryan", label: "甜茶 (Ryan)" },
  { id: "Katerina", label: "卡捷琳娜 (Katerina)" },
  { id: "Dylan", label: "北京-晓东 (Dylan)" },
  { id: "Sunny", label: "四川-晴儿 (Sunny)" },
  { id: "Peter", label: "天津-李彼得 (Peter)" },
  { id: "Rocky", label: "粤语-阿强 (Rocky)" },
  { id: "Kiki", label: "粤语-阿清 (Kiki)" },
] as const;

/** Get available browser SpeechSynthesis voices */
export function getBrowserVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

/** Clean text for TTS: remove references like [1], extra whitespace */
function cleanText(text: string): string {
  return text
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Count characters (CJK = 2 units, others = 1) */
function countChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    count += /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(ch) ? 2 : 1;
  }
  return count;
}

/** Split text into chunks at sentence boundaries */
export function splitIntoChunks(text: string, maxChars = 500): string[] {
  const cleaned = cleanText(text);
  if (countChars(cleaned) <= maxChars) return [cleaned];

  const sentences = cleaned.split(/(?<=[。！？.!?\n])\s*/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (countChars(current + sentence) > maxChars && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Browser SpeechSynthesis ──

export class BrowserTTSPlayer {
  private utterance: SpeechSynthesisUtterance | null = null;
  private chunks: string[] = [];
  private currentIndex = 0;
  private _speaking = false;
  private _paused = false;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  /** Called when all chunks have finished playing (natural end, not stop()) */
  onEnd?: () => void;

  get speaking() { return this._speaking; }
  get paused() { return this._paused; }

  speak(text: string, config: TTSConfig) {
    this.stop();
    this.chunks = splitIntoChunks(text);
    this.currentIndex = 0;
    this._speaking = true;
    this._paused = false;
    this.onStateChange?.("playing");
    this.speakChunk(config);
  }

  private speakChunk(config: TTSConfig) {
    if (this.currentIndex >= this.chunks.length) {
      // Natural end — notify before resetting state
      const onEnd = this.onEnd;
      this._speaking = false;
      this._paused = false;
      window.speechSynthesis.cancel();
      this.utterance = null;
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
      const voice = synth.getVoices().find((v) => v.name === config.voiceName);
      if (voice) utt.voice = voice;
    }

    utt.onend = () => {
      this.currentIndex++;
      this.onChunkChange?.(this.currentIndex, this.chunks.length);
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

    this.utterance = utt;
    this.onChunkChange?.(this.currentIndex, this.chunks.length);
    synth.speak(utt);
  }

  pause() {
    if (!this._speaking || this._paused) return;
    window.speechSynthesis.pause();
    this._paused = true;
    this.onStateChange?.("paused");
  }

  resume() {
    if (!this._speaking || !this._paused) return;
    window.speechSynthesis.resume();
    this._paused = false;
    this.onStateChange?.("playing");
  }

  stop() {
    window.speechSynthesis.cancel();
    this.utterance = null;
    this.chunks = [];
    this.currentIndex = 0;
    this._speaking = false;
    this._paused = false;
    this.onStateChange?.("stopped");
  }
}

// ── DashScope TTS (Alibaba Cloud qwen3-tts-flash) — Real-time Streaming ──

/**
 * Uses AudioContext to play SSE base64 audio chunks in real-time.
 * Each SSE event's base64 data is decoded and scheduled on AudioContext
 * immediately, so playback starts as soon as the first chunk arrives.
 *
 * For multi-chunk text (split by splitIntoChunks), each text chunk
 * spawns a separate SSE stream. Streams are processed sequentially
 * but within each stream, audio is played as it arrives.
 */
export class DashScopeTTSPlayer {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledEnd = 0;
  private _playing = false;
  private _paused = false;
  private allChunksDone = false;
  private abortController: AbortController | null = null;
  private checkEndTimer: ReturnType<typeof setInterval> | null = null;
  /** Accumulated raw PCM/mp3 bytes from SSE, batched for decoding */
  private pendingBytes: Uint8Array[] = [];
  private decodeTimeout: ReturnType<typeof setTimeout> | null = null;

  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  get playing() { return this._playing; }
  get paused() { return this._paused; }

  async speak(text: string, config: TTSConfig) {
    this.stop();
    const chunks = splitIntoChunks(text);
    this._playing = true;
    this._paused = false;
    this.allChunksDone = false;

    // Create AudioContext
    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);
    this.scheduledEnd = 0;

    // Monitor for playback completion
    this.checkEndTimer = setInterval(() => {
      if (!this._playing) return;
      if (this.allChunksDone && this.audioCtx) {
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
    this.allChunksDone = true;
  }

  private async streamChunk(
    text: string,
    config: TTSConfig,
    isFirst: boolean,
  ): Promise<void> {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    this.abortController = new AbortController();
    this.pendingBytes = [];

    const response = await tauriFetch(
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
      if (!this._playing) { reader.cancel(); return; }
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

            // Batch: flush pending bytes for decoding with debounce
            this.scheduleFlush();
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    // Flush any remaining bytes
    this.flushPendingBytes();
  }

  private scheduleFlush() {
    if (this.decodeTimeout) return;
    this.decodeTimeout = setTimeout(() => {
      this.decodeTimeout = null;
      this.flushPendingBytes();
    }, 100);
  }

  /**
   * Convert raw PCM 16-bit signed LE bytes → Float32 AudioBuffer and schedule playback.
   * DashScope qwen3-tts-flash SSE returns: mono, 16-bit signed PCM, 24kHz.
   */
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

    // PCM 16-bit LE → Float32
    const PCM_SAMPLE_RATE = 24000;
    const numSamples = Math.floor(merged.length / 2); // 2 bytes per sample (16-bit)
    if (numSamples === 0) return;

    const ctx = this.audioCtx;
    const gain = this.gainNode;
    const audioBuffer = ctx.createBuffer(1, numSamples, PCM_SAMPLE_RATE);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);

    for (let i = 0; i < numSamples; i++) {
      // Read 16-bit signed little-endian, normalize to [-1, 1]
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

// ── Singleton instances ──
export const browserTTS = new BrowserTTSPlayer();
export const dashscopeTTS = new DashScopeTTSPlayer();
