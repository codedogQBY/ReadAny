import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
import SystemTtsSynthesis from "../../../modules/system-tts-synthesis";

function normalizeSegments(text: string | string[]): string[] {
  return (Array.isArray(text) ? text : [text]).map((segment) => segment.trim()).filter(Boolean);
}

function guessLanguage(text: string): string {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  if (cjk && cjk.length > text.length * 0.1) return "zh-CN";
  return "en-US";
}

export class NativeSystemTTSPlayer implements ITTSPlayer {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onChunkChange?: (index: number, total: number) => void;
  onVirtualProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
  onRemoteNext?: () => void;
  onRemotePrevious?: () => void;
  onRemoteSeek?: (positionSeconds: number, durationSeconds: number) => void;

  private _session = 0;
  private _startIndex = 0;
  private _unsubscribe?: () => void;
  private _lastChunkIndex = -1;

  constructor() {
    this._unsubscribe = SystemTtsSynthesis.addListener("SystemTtsPlayback", (event) =>
      this._handleEvent(event),
    ).remove;
  }

  setMetadata(title: string, artist: string, album: string, artwork?: string): void {
    SystemTtsSynthesis.setMetadata(title, artist, album, artwork);
  }

  setConfig(config: TTSConfig): void {
    SystemTtsSynthesis.setPlaybackOptions({
      rate: config.rate,
      pitch: config.pitch,
      language: undefined,
      voice: config.voiceName,
    });
  }

  async speak(text: string | string[], config: TTSConfig): Promise<void> {
    const session = ++this._session;
    const segments = normalizeSegments(text);
    if (segments.length === 0) {
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    this._lastChunkIndex = -1;
    this._startIndex = 0;
    await SystemTtsSynthesis.speak(
      segments,
      {
        rate: config.rate,
        pitch: config.pitch,
        language: config.voiceName ? undefined : guessLanguage(segments[0] || ""),
        voice: config.voiceName,
      },
      0,
    );
    if (session !== this._session) return;
  }

  async speakFrom(text: string | string[], startIndex: number, config: TTSConfig): Promise<void> {
    const session = ++this._session;
    const segments = normalizeSegments(text);
    if (segments.length === 0) {
      this.onStateChange?.("stopped");
      this.onEnd?.();
      return;
    }

    this._lastChunkIndex = -1;
    this._startIndex = Math.max(0, Math.min(startIndex, segments.length - 1));
    await SystemTtsSynthesis.speak(
      segments,
      {
        rate: config.rate,
        pitch: config.pitch,
        language: config.voiceName ? undefined : guessLanguage(segments[startIndex] || ""),
        voice: config.voiceName,
      },
      this._startIndex,
    );
    if (session !== this._session) return;
  }

  append(text: string | string[]): boolean {
    const segments = normalizeSegments(text);
    if (segments.length === 0) return false;
    return SystemTtsSynthesis.append(segments);
  }

  pause(): void {
    SystemTtsSynthesis.pause();
  }

  resume(): void {
    SystemTtsSynthesis.resume();
  }

  stop(): void {
    this._session += 1;
    SystemTtsSynthesis.stopPlayback();
    this.onStateChange?.("stopped");
  }

  async seekToChunk(index: number): Promise<boolean> {
    if (index < 0) return false;
    SystemTtsSynthesis.seekToChunk(index);
    return true;
  }

  private _handleEvent(event: {
    type: "state" | "chunk" | "range" | "progress" | "next" | "previous" | "seek" | "error" | "end";
    state?: "playing" | "paused" | "stopped";
    index?: number;
    total?: number;
    position?: number;
    duration?: number;
    message?: string;
  }): void {
    if (event.type === "state" && event.state) {
      if (event.state === "stopped") this._lastChunkIndex = -1;
      this.onStateChange?.(event.state);
      return;
    }

    if (event.type === "chunk" && event.index != null && event.total != null) {
      const relativeIndex = event.index - this._startIndex;
      if (relativeIndex >= 0 && relativeIndex !== this._lastChunkIndex) {
        this._lastChunkIndex = relativeIndex;
        this.onChunkChange?.(relativeIndex, event.total - this._startIndex);
      }
    }

    if (event.type === "progress" || event.type === "chunk") {
      if (event.position != null && event.duration != null && event.duration > 0) {
        this.onVirtualProgress?.(event.position, event.duration);
      }
    }

    if (event.type === "error") {
      this._session += 1;
      this.onError?.(new Error(event.message || "System TTS playback failed"));
      return;
    }

    if (event.type === "end") this.onEnd?.();

    if (event.type === "next") this.onRemoteNext?.();
    if (event.type === "previous") this.onRemotePrevious?.();
    if (event.type === "seek" && event.position != null && event.duration != null) {
      this.onRemoteSeek?.(event.position, event.duration);
    }
  }
}
