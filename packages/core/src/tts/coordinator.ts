import { SegmentPlanner, type Segment, type SegmentPosition } from "./segment-planner";
import type { ITTSPlayer, TTSConfig } from "./types";

export type TTSCoordinatorStatus = "idle" | "loading" | "playing" | "paused" | "stopping" | "error";
export interface TTSCoordinatorState {
  status: TTSCoordinatorStatus;
  sessionId: string | null;
  segmentIndex: number;
  totalSegments: number;
  error?: TTSCoordinatorError;
}
export interface TTSCoordinatorError {
  sessionId: string;
  provider: string;
  segmentIndex: number;
  state: TTSCoordinatorStatus;
  cause: Error;
}
export interface TTSCoordinatorCallbacks {
  onStateChange?(state: TTSCoordinatorState): void;
  onSegment?(index: number, total: number): void;
  onEnd?(): void;
  onError?(error: TTSCoordinatorError): void;
}

export function normalizeTTSError(
  error: unknown,
  context: Omit<TTSCoordinatorError, "cause">,
): TTSCoordinatorError {
  return { ...context, cause: error instanceof Error ? error : new Error(String(error)) };
}

export class LegacyPlayerProvider {
  constructor(
    readonly player: ITTSPlayer,
    readonly id: string,
  ) {}
  async play(
    segment: Segment,
    config: TTSConfig,
    callbacks: { onStart(): void; onEnd(): void; onError(error: unknown): void },
  ): Promise<void> {
    this.player.onEnd = callbacks.onEnd;
    this.player.onError = callbacks.onError;
    let started = false;
    let invoking = true;
    this.player.onStateChange = (state) => {
      if (state === "playing") {
        started = true;
        callbacks.onStart();
      } else if (state === "stopped" && (started || !invoking)) callbacks.onEnd();
    };
    const result = this.player.speak(segment.text, config);
    invoking = false;
    await result;
  }
  async playQueue(
    segments: Segment[],
    config: TTSConfig,
    startIndex: number,
    callbacks: {
      onStart(): void;
      onChunk(index: number, total: number): void;
      onEnd(): void;
      onError(error: unknown): void;
    },
  ): Promise<void> {
    let started = false;
    let invoking = true;
    this.player.onStateChange = (state) => {
      if (state === "playing") {
        started = true;
        callbacks.onStart();
      } else if (state === "stopped" && (started || !invoking)) callbacks.onEnd();
    };
    this.player.onChunkChange = (index, total) =>
      callbacks.onChunk(
        startIndex + index,
        Math.max(total + startIndex, segments.length + startIndex),
      );
    this.player.onEnd = callbacks.onEnd;
    this.player.onError = callbacks.onError;
    const result = this.player.speak(
      segments.map((segment) => segment.text),
      config,
    );
    invoking = false;
    await result;
  }
  stop(): void {
    this.player.stop();
  }
  pause(): void {
    this.player.pause();
  }
  resume(): void {
    this.player.resume();
  }
}

export class TTSCoordinator {
  private state: TTSCoordinatorState = {
    status: "idle",
    sessionId: null,
    segmentIndex: 0,
    totalSegments: 0,
  };
  private session: { id: string; abort: AbortController } | null = null;
  private segments: Segment[] = [];
  private currentProvider: LegacyPlayerProvider | null = null;
  private readonly planner: SegmentPlanner;
  constructor(
    private config: TTSConfig,
    planner = new SegmentPlanner(),
    private readonly callbacks: TTSCoordinatorCallbacks = {},
  ) {
    this.planner = planner;
  }
  getState(): TTSCoordinatorState {
    return this.state;
  }
  updateConfig(config: TTSConfig): void {
    this.config = config;
  }
  play(text: string | string[], provider: LegacyPlayerProvider): void {
    this.cancelSession();
    this.segments = this.planner.plan(text);
    this.currentProvider = provider;
    const session = this.startSession();
    this.state = {
      status: "loading",
      sessionId: session.id,
      segmentIndex: 0,
      totalSegments: this.segments.length,
    };
    this.emit();
    this.playCurrent(session.id);
  }
  pause(): void {
    if (this.state.status === "playing" || this.state.status === "loading") {
      this.currentProvider?.pause();
      this.state = { ...this.state, status: "paused" };
      this.emit();
    }
  }
  resume(): void {
    if (this.state.status === "paused") {
      this.currentProvider?.resume();
      this.state = { ...this.state, status: "playing" };
      this.emit();
    }
  }
  stop(): void {
    this.cancelSession();
    this.state = { status: "idle", sessionId: null, segmentIndex: 0, totalSegments: 0 };
    this.emit();
  }
  jumpTo(position: SegmentPosition): void {
    const index = this.planner.findStart(this.segments, position);
    if (index >= 0 && index < this.segments.length) {
      this.cancelSession();
      this.state = { ...this.state, status: "loading", segmentIndex: index };
      const session = this.startSession();
      this.state.sessionId = session.id;
      this.emit();
      this.playCurrent(session.id);
    }
  }
  private playCurrent(sessionId: string): void {
    const segment = this.segments[this.state.segmentIndex];
    const provider = this.currentProvider;
    if (!segment || !provider) {
      this.stop();
      this.callbacks.onEnd?.();
      return;
    }
    this.callbacks.onSegment?.(segment.index, this.segments.length);
    const callbacks = {
      onStart: () => {
        if (!this.isCurrent(sessionId)) return;
        this.state = { ...this.state, status: "playing" };
        this.emit();
      },
      onChunk: (index: number, total: number) => {
        if (!this.isCurrent(sessionId)) return;
        this.state = { ...this.state, segmentIndex: index, totalSegments: total };
        this.callbacks.onSegment?.(index, total);
        this.emit();
      },
      onEnd: () => {
        if (!this.isCurrent(sessionId)) return;
        this.stop();
        this.callbacks.onEnd?.();
      },
      onError: (error: unknown) => {
        if (!this.isCurrent(sessionId)) return;
        const normalized = normalizeTTSError(error, {
          sessionId,
          provider: provider.id,
          segmentIndex: this.state.segmentIndex,
          state: this.state.status,
        });
        this.state = { ...this.state, status: "error", error: normalized };
        this.emit();
        this.callbacks.onError?.(normalized);
      },
    };
    Promise.resolve(
      provider.playQueue(
        this.segments.slice(this.state.segmentIndex),
        this.config,
        this.state.segmentIndex,
        callbacks,
      ),
    ).catch(callbacks.onError);
    // Providers report the actual start through their player callbacks. Keep
    // loading until then so legacy players preserve their startup semantics.
  }
  private startSession() {
    const session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      abort: new AbortController(),
    };
    this.session = session;
    return session;
  }
  private cancelSession() {
    this.session?.abort.abort();
    this.currentProvider?.stop();
    this.session = null;
  }
  private isCurrent(id: string) {
    return this.session?.id === id && !this.session.abort.signal.aborted;
  }
  private emit() {
    this.callbacks.onStateChange?.(this.state);
  }
}
