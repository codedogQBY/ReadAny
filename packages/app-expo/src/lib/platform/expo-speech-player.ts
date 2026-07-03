import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
/**
 * ExpoSpeechTTSPlayer — ITTSPlayer backed by expo-speech (native OS TTS).
 *
 * NOTE: Apple's TextToSpeech.framework crashes if speech is active when the
 * app is backgrounded. We listen for AppState changes and stop speech before
 * the system kills it.
 */
import * as Speech from "expo-speech";
import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
  Platform,
} from "react-native";

export class ExpoSpeechTTSPlayer implements ITTSPlayer {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onEnd?: () => void;

  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _stopped = false;
  private _appStateSubscription: NativeEventSubscription | null = null;

  private _handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (Platform.OS === "ios" && nextAppState === "background") {
      if (!this._stopped) {
        this.stop();
      }
    }
  };

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    // Register AppState listener to stop speech on background (prevents crash)
    this._appStateSubscription?.remove();
    this._appStateSubscription = AppState.addEventListener("change", this._handleAppStateChange);
    this._stopped = false;

    // Split long text into chunks (expo-speech works best with shorter segments)
    this._chunks = Array.isArray(text) ? text.filter(Boolean) : splitIntoChunks(text, 200);
    this._currentIndex = 0;

    this.onStateChange?.("playing");
    await this._speakChunk(config);
  }

  private async _speakChunk(config: TTSConfig): Promise<void> {
    if (this._stopped || this._currentIndex >= this._chunks.length) {
      if (!this._stopped) {
        // All chunks finished — remove AppState listener and fire callbacks
        this._appStateSubscription?.remove();
        this._appStateSubscription = null;
        this.onStateChange?.("stopped");
        this.onEnd?.();
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
          this._currentIndex++;
          this._speakChunk(config).then(resolve);
        },
        onStopped: () => {
          resolve();
        },
        onError: () => {
          this._currentIndex++;
          this._speakChunk(config).then(resolve);
        },
      });
    });
  }

  pause(): void {
    Speech.pause();
    this.onStateChange?.("paused");
  }

  resume(): void {
    Speech.resume();
    this.onStateChange?.("playing");
  }

  stop(): void {
    this._stopped = true;
    Speech.stop();
    this._appStateSubscription?.remove();
    this._appStateSubscription = null;
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
