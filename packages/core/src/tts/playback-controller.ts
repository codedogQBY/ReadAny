import { splitNarrationText } from "./display";
import type { ITTSPlayer, TTSConfig } from "./types";

export type TTSControllerState = "playing" | "paused" | "stopped";

export interface TTSPlaybackSnapshot {
  state: TTSControllerState;
  segments: string[];
  currentIndex: number;
}

export interface TTSPlaybackCallbacks {
  onStateChange?: (state: TTSControllerState) => void;
  onSegmentChange?: (index: number, total: number, text: string) => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  configurePlayer?: (player: ITTSPlayer) => void;
}

export type TTSPlayerResolver = (config: TTSConfig) => ITTSPlayer;
export type TTSPreloader = (segments: string[], config: TTSConfig) => void | Promise<void>;

function normalizeSegments(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : splitNarrationText(input);
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * Platform-neutral playback application service.
 *
 * Foliate/document adapters decide which text belongs to a session. This
 * service only owns the ordered narration queue and guards callbacks from
 * stale players after stop, jump, or provider changes.
 */
export class TTSPlaybackController {
  private player: ITTSPlayer | null = null;
  private segments: string[] = [];
  private currentIndex = 0;
  private generation = 0;
  private starting = false;
  private state: TTSControllerState = "stopped";

  constructor(
    private readonly resolvePlayer: TTSPlayerResolver,
    private readonly callbacks: TTSPlaybackCallbacks = {},
    private readonly preloadSegments?: TTSPreloader,
  ) {}

  snapshot(): TTSPlaybackSnapshot {
    return {
      state: this.state,
      segments: [...this.segments],
      currentIndex: this.currentIndex,
    };
  }

  play(input: string | string[], config: TTSConfig): boolean {
    const segments = normalizeSegments(input);
    if (!segments.length) return false;
    console.log("[TTSPlaybackController][play] request", {
      inputType: Array.isArray(input) ? "array" : "text",
      count: segments.length,
      segments: segments.map((text, index) => ({ index, text: text.slice(0, 160) })),
      engine: config.engine,
    });
    this.stop();
    this.segments = segments;
    this.currentIndex = 0;
    this.startFrom(0, config);
    return true;
  }

  append(input: string | string[]): boolean {
    const segments = normalizeSegments(input);
    if (!segments.length || !this.player?.append) return false;
    try {
      const result = this.player.append(segments);
      void Promise.resolve(result).catch((error) =>
        this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error))),
      );
      this.segments = [...this.segments, ...segments];
      return true;
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  preload(input: string | string[], config: TTSConfig): boolean {
    const segments = normalizeSegments(input);
    if (!segments.length || !this.preloadSegments) return false;
    console.log("[TTSPlaybackController][preload] request", {
      count: segments.length,
      segments: segments.map((text, index) => ({ index, text: text.slice(0, 160) })),
      engine: config.engine,
    });
    try {
      void Promise.resolve(this.preloadSegments(segments, config)).catch((error) =>
        this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error))),
      );
      return true;
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  pause(): void {
    // A cloud/native player may still be preparing its first audio chunk while
    // the store is already in loading state. Pause must reach that player too.
    if (!this.player || this.state === "paused" || this.segments.length === 0) return;
    this.player.pause();
    this.setState("paused");
  }

  resume(config: TTSConfig): void {
    if (this.state === "paused" && this.player) {
      this.player.resume();
      this.setState("playing");
      return;
    }
    if (this.segments.length && this.state === "stopped") {
      this.startFrom(Math.min(this.currentIndex, this.segments.length - 1), config);
    }
  }

  jumpTo(index: number, config: TTSConfig): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.segments.length) return false;
    this.stop();
    this.currentIndex = index;
    this.startFrom(index, config);
    return true;
  }

  stop(): void {
    this.generation += 1;
    this.detachPlayer();
    this.state = "stopped";
  }

  clear(): void {
    this.stop();
    this.segments = [];
    this.currentIndex = 0;
  }

  private startFrom(index: number, config: TTSConfig): void {
    const generation = ++this.generation;
    let player: ITTSPlayer;
    try {
      player = this.resolvePlayer(config);
    } catch (error) {
      this.fail(generation, error);
      return;
    }
    this.player = player;
    console.log("[TTSPlaybackController][start]", {
      generation,
      startIndex: index,
      total: this.segments.length,
      segments: this.segments.map((text, segmentIndex) => ({
        index: segmentIndex,
        text: text.slice(0, 160),
      })),
    });
    this.callbacks.configurePlayer?.(player);
    this.starting = true;
    this.bindPlayer(player, generation, index);
    try {
      const result = player.speak(this.segments.slice(index), config);
      this.starting = false;
      void Promise.resolve(result).catch((error) => this.fail(generation, error));
    } catch (error) {
      this.starting = false;
      this.fail(generation, error);
    }
  }

  private bindPlayer(player: ITTSPlayer, generation: number, startIndex: number): void {
    player.onStateChange = (state) => {
      if (generation !== this.generation) return;
      console.log("[TTSPlaybackController][state]", { generation, state });
      if (this.starting && state === "stopped") return;
      this.setState(state);
    };
    player.onChunkChange = (index) => {
      if (generation !== this.generation) return;
      this.currentIndex = startIndex + index;
      console.log("[TTSPlaybackController][chunk]", {
        generation,
        playerIndex: index,
        currentIndex: this.currentIndex,
        total: this.segments.length,
        text: this.segments[this.currentIndex]?.slice(0, 160) ?? "",
      });
      this.callbacks.onSegmentChange?.(
        this.currentIndex,
        this.segments.length,
        this.segments[this.currentIndex] ?? "",
      );
    };
    player.onError = (error) => this.fail(generation, error);
    player.onEnd = () => {
      if (generation !== this.generation) return;
      console.log("[TTSPlaybackController][end]", {
        generation,
        currentIndex: this.currentIndex,
        total: this.segments.length,
        currentText: this.segments[this.currentIndex]?.slice(0, 160) ?? "",
      });
      this.currentIndex = Math.max(0, this.segments.length - 1);
      this.detachPlayer();
      this.setState("stopped");
      this.callbacks.onSegmentChange?.(
        this.currentIndex,
        this.segments.length,
        this.segments[this.currentIndex] ?? "",
      );
      this.callbacks.onEnd?.();
    };
  }

  private fail(generation: number, error: unknown): void {
    if (generation !== this.generation) return;
    this.detachPlayer();
    this.setState("stopped");
    this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  private detachPlayer(): void {
    if (!this.player) return;
    const player = this.player;
    this.player = null;
    player.onStateChange = undefined;
    player.onChunkChange = undefined;
    player.onError = undefined;
    player.onEnd = undefined;
    try {
      player.stop();
    } catch {
      // A stale platform player must not break store cleanup.
    }
  }

  private setState(state: TTSControllerState): void {
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }
}
