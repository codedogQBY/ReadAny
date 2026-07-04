import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
/**
 * ExpoSpeechTTSPlayer — ITTSPlayer backed by expo-speech (native OS TTS).
 */
import * as Speech from "expo-speech";
import { Platform } from "react-native";

export class ExpoSpeechTTSPlayer implements ITTSPlayer {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _stopped = false;
  private _paused = false;
  private _config: TTSConfig | null = null;

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    this._stopped = false;
    this._paused = false;
    this._config = config;

    // Split long text into chunks (expo-speech works best with shorter segments)
    this._chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text, 200);
    this._currentIndex = 0;

    this.onStateChange?.("playing");
    await this._speakChunk(config);
  }

  private async _speakChunk(config: TTSConfig): Promise<void> {
    if (this._stopped || this._paused || this._currentIndex >= this._chunks.length) {
      if (!this._stopped) {
        if (this._paused) {
          this.onStateChange?.("paused");
        } else {
          this.onStateChange?.("stopped");
          this.onEnd?.();
        }
      }
      return;
    }

    const chunk = this._chunks[this._currentIndex];
    this.onChunkChange?.(this._currentIndex, this._chunks.length);

    return new Promise<void>((resolve) => {
      Speech.speak(chunk, {
        rate: config.rate,
        pitch: config.pitch,
        ...(config.voiceName ? { voice: config.voiceName } : { language: guessLanguage(chunk) }),
        onDone: () => {
          if (this._stopped || this._paused) {
            resolve();
            return;
          }
          this._currentIndex++;
          this._speakChunk(config).then(resolve);
        },
        onStopped: () => {
          resolve();
        },
        onError: () => {
          if (this._stopped || this._paused) {
            resolve();
            return;
          }
          this._currentIndex++;
          this._speakChunk(config).then(resolve);
        },
      });
    });
  }

  pause(): void {
    if (this._stopped || this._paused) return;
    this._paused = true;
    if (Platform.OS === "android") {
      void Speech.stop().catch((err) =>
        console.warn("[ExpoSpeechTTSPlayer] stop-on-pause failed", err),
      );
      this.onStateChange?.("paused");
      return;
    }
    void Speech.pause().catch((err) => {
      console.warn("[ExpoSpeechTTSPlayer] pause failed; stopping current utterance", err);
      void Speech.stop().catch(() => {});
    });
    this.onStateChange?.("paused");
  }

  resume(): void {
    if (this._stopped || !this._paused) return;
    this._paused = false;
    if (Platform.OS === "android") {
      const config = this._config;
      if (!config) {
        this.onStateChange?.("stopped");
        return;
      }
      this.onStateChange?.("playing");
      void this._speakChunk(config);
      return;
    }
    void Speech.resume().catch((err) => {
      console.warn("[ExpoSpeechTTSPlayer] resume failed; restarting current utterance", err);
      if (this._config) void this._speakChunk(this._config);
    });
    this.onStateChange?.("playing");
  }

  stop(): void {
    this._stopped = true;
    this._paused = false;
    void Speech.stop().catch((err) => console.warn("[ExpoSpeechTTSPlayer] stop failed", err));
    this.onStateChange?.("stopped");
  }
}

/** Split text into chunks at sentence boundaries */
function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Find last sentence boundary within maxLen
    let splitAt = maxLen;
    const sub = remaining.substring(0, maxLen);
    const lastPeriod = Math.max(
      sub.lastIndexOf("。"),
      sub.lastIndexOf(". "),
      sub.lastIndexOf("！"),
      sub.lastIndexOf("？"),
      sub.lastIndexOf("\n"),
    );
    if (lastPeriod > maxLen * 0.3) {
      splitAt = lastPeriod + 1;
    }
    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return chunks.filter(Boolean);
}

/** Simple heuristic to guess language from text */
function guessLanguage(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (cjk && cjk.length > text.length * 0.1) return "zh-CN";
  return "en-US";
}
