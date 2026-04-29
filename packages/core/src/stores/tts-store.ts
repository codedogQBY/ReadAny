/**
 * TTS Store — Zustand store for TTS state and configuration.
 *
 * Manages:
 * - Playback state (playing/paused/stopped)
 * - TTS configuration (engine, voice, rate, pitch, DashScope key)
 * - Persists config to FS
 *
 * Cross-platform: player factories are injectable. By default uses a Web-based
 * system TTS player plus EdgeTTSPlayer/DashScopeTTSPlayer. Platforms without Web Audio
 * (e.g. React Native) can override via `setTTSPlayerFactories()`.
 */
import { create } from "zustand";
import { BrowserTTSPlayer, DashScopeTTSPlayer, EdgeTTSPlayer } from "../tts/tts-players";
import type { ITTSPlayer, TTSConfig } from "../tts/types";
import { DEFAULT_TTS_CONFIG, normalizeTTSConfig } from "../tts/types";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

/**
 * TTS player factory interface — allows platforms to provide custom player implementations.
 */
export interface TTSPlayerFactories {
  createSystemTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
}

/** Default Web-based factories */
const defaultFactories: TTSPlayerFactories = {
  createSystemTTS: () => new BrowserTTSPlayer(),
  createEdgeTTS: () => new EdgeTTSPlayer(),
  createDashScopeTTS: () => new DashScopeTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;

/**
 * Override TTS player factories for platforms that cannot use Web Audio APIs.
 * Call this at app startup before any TTS playback.
 *
 * Example (React Native):
 *   setTTSPlayerFactories({
 *     createSystemTTS: () => new ExpoSpeechTTSPlayer(),
 *     createEdgeTTS: () => new ExpoAVEdgeTTSPlayer(),
 *     createDashScopeTTS: () => new ExpoAVDashScopeTTSPlayer(),
 *   });
 */
export function setTTSPlayerFactories(factories: Partial<TTSPlayerFactories>): void {
  _factories = { ...defaultFactories, ...factories };
  // Reset cached instances so new factories take effect
  _systemTTS = null;
  _edgeTTS = null;
  _dashscopeTTS = null;
}

/** Lazily-created singleton TTS player instances */
let _systemTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;
let _sessionSegments: string[] = [];
let _sessionCurrentIndex = 0;
/** Generation counter — incremented on every play/jumpToChunk to invalidate stale callbacks */
let _sessionGeneration = 0;
let _sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;

function getSystemTTS(): ITTSPlayer {
  if (!_systemTTS) _systemTTS = _factories.createSystemTTS();
  return _systemTTS;
}

function getEdgeTTS(): ITTSPlayer {
  if (!_edgeTTS) _edgeTTS = _factories.createEdgeTTS();
  return _edgeTTS;
}

function getDashScopeTTS(): ITTSPlayer {
  if (!_dashscopeTTS) _dashscopeTTS = _factories.createDashScopeTTS();
  return _dashscopeTTS;
}

function clearSleepTimerHandle(): void {
  if (_sleepTimerHandle) {
    clearTimeout(_sleepTimerHandle);
    _sleepTimerHandle = null;
  }
}

export interface TTSState {
  /** Current playback state */
  playState: TTSPlayState;
  /** Current text being spoken */
  currentText: string;
  /** TTS configuration (persisted) */
  config: TTSConfig;
  /** Callback invoked when current text finishes playing naturally (not by stop) */
  onEnd: (() => void) | null;
  /** Index of the currently-speaking chunk (0-based) */
  currentChunkIndex: number;
  /** Total number of chunks for the current text */
  totalChunks: number;
  /** Title of the book currently being read (for floating bubble display) */
  currentBookTitle: string;
  /** Chapter title currently being read (for floating bubble display) */
  currentChapterTitle: string;
  /** Book ID currently being read (for navigation back to reader) */
  currentBookId: string;
  /** Current reading CFI for jump-back from floating mini-player */
  currentLocationCfi: string;
  /** Absolute timestamp when playback should stop automatically */
  sleepTimerEndsAt: number | null;
  /** Original timer length selected by the user, in minutes */
  sleepTimerDurationMinutes: number | null;

  // Actions
  play: (text: string | string[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
  setCurrentBook: (title: string, chapter: string, bookId?: string) => void;
  setCurrentLocation: (cfi?: string | null) => void;
  setChunkProgress: (index: number, total: number) => void;
  /** Jump to a specific chunk index within the current session, restarting speech from that point */
  jumpToChunk: (index: number) => void;
  setSleepTimer: (minutes: number) => void;
  clearSleepTimer: () => void;
}

export const useTTSStore = create<TTSState>()(
  withPersist<TTSState>(
    "tts",
    (set, get) => ({
      playState: "stopped",
      currentText: "",
      config: DEFAULT_TTS_CONFIG,
      onEnd: null,
      currentChunkIndex: 0,
      totalChunks: 0,
      currentBookTitle: "",
      currentChapterTitle: "",
      currentBookId: "",
      currentLocationCfi: "",
      sleepTimerEndsAt: null,
      sleepTimerDurationMinutes: null,

      play: (text: string | string[]) => {
        const config = normalizeTTSConfig(get().config);
        const segments = Array.isArray(text)
          ? text.map((item) => item.trim()).filter(Boolean)
          : [text.trim()].filter(Boolean);
        const sessionSegments =
          segments.length > 0
            ? segments
            : [Array.isArray(text) ? text.join(" ").trim() : text.trim()].filter(Boolean);
        _sessionSegments = sessionSegments;
        _sessionCurrentIndex = 0;
        _sessionGeneration += 1;
        const gen = _sessionGeneration;
        set({
          playState: "loading",
          currentText: sessionSegments.join(" "),
          currentChunkIndex: 0,
          totalChunks: sessionSegments.length,
        });

        const onState = (state: "playing" | "paused" | "stopped") => {
          if (gen !== _sessionGeneration) return;
          set({ playState: state });
        };

        const onChunk = (index: number, total: number) => {
          if (gen !== _sessionGeneration) return;
          _sessionCurrentIndex = index;
          set({ currentChunkIndex: index, totalChunks: total });
        };

        const handleEnd = () => {
          if (gen !== _sessionGeneration) return;
          const currentOnEnd = get().onEnd;
          currentOnEnd?.();
        };

        if (config.engine === "dashscope" && config.dashscopeApiKey) {
          const player = getDashScopeTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(sessionSegments, config);
        } else if (config.engine === "edge") {
          const player = getEdgeTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(sessionSegments, config);
        } else {
          const player = getSystemTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(sessionSegments, config);
        }
      },

      pause: () => {
        const config = normalizeTTSConfig(get().config);
        const { playState } = get();
        if (playState !== "playing") return;
        if (config.engine === "dashscope" && config.dashscopeApiKey) {
          getDashScopeTTS().pause();
        } else if (config.engine === "edge") {
          getEdgeTTS().pause();
        } else {
          // expo-speech pause is unreliable on React Native; keep a stable store-level pause by stopping.
          getSystemTTS().stop();
        }
        set({ playState: "paused" });
      },

      resume: () => {
        const config = normalizeTTSConfig(get().config);
        const { playState } = get();
        if (playState !== "paused") return;
        if (_sessionSegments.length > 0) {
          const nextIndex = Math.max(
            0,
            Math.min(_sessionCurrentIndex, _sessionSegments.length - 1),
          );
          const remainingSegments = _sessionSegments.slice(nextIndex);
          if (remainingSegments.length > 0) {
            _sessionGeneration += 1;
            const gen = _sessionGeneration;
            const onState = (state: "playing" | "paused" | "stopped") => {
              if (gen !== _sessionGeneration) return;
              set({ playState: state });
            };
            const onChunk = (index: number) => {
              if (gen !== _sessionGeneration) return;
              const absoluteIndex = nextIndex + index;
              _sessionCurrentIndex = absoluteIndex;
              set({ currentChunkIndex: absoluteIndex, totalChunks: _sessionSegments.length });
            };
            const handleEnd = () => {
              if (gen !== _sessionGeneration) return;
              const currentOnEnd = get().onEnd;
              currentOnEnd?.();
            };

            if (config.engine === "dashscope" && config.dashscopeApiKey) {
              const player = getDashScopeTTS();
              player.onStateChange = onState;
              player.onChunkChange = onChunk;
              player.onEnd = handleEnd;
              player.speak(remainingSegments, config);
              return;
            }

            if (config.engine === "edge") {
              const player = getEdgeTTS();
              player.onStateChange = onState;
              player.onChunkChange = onChunk;
              player.onEnd = handleEnd;
              player.speak(remainingSegments, config);
              return;
            }

            const player = getSystemTTS();
            player.onStateChange = onState;
            player.onChunkChange = onChunk;
            player.onEnd = handleEnd;
            player.speak(remainingSegments, config);
            return;
          }
        }
        set({ playState: "stopped" });
      },

      stop: () => {
        clearSleepTimerHandle();
        const system = getSystemTTS();
        const edge = getEdgeTTS();
        const dashscope = getDashScopeTTS();
        system.onEnd = undefined;
        edge.onEnd = undefined;
        dashscope.onEnd = undefined;
        system.stop();
        edge.stop();
        dashscope.stop();
        _sessionSegments = [];
        _sessionCurrentIndex = 0;
        set({
          playState: "stopped",
          currentText: "",
          onEnd: null,
          currentChunkIndex: 0,
          totalChunks: 0,
          currentBookTitle: "",
          currentChapterTitle: "",
          currentBookId: "",
          currentLocationCfi: "",
          sleepTimerEndsAt: null,
          sleepTimerDurationMinutes: null,
        });
      },

      toggle: (text?: string) => {
        const { playState, currentText, play, pause, resume } = get();
        if (playState === "playing") {
          pause();
        } else if (playState === "paused") {
          resume();
        } else if (text) {
          play(text);
        } else if (currentText) {
          play(currentText);
        }
      },

      updateConfig: (updates) =>
        set((s) => ({
          config: normalizeTTSConfig({ ...s.config, ...updates }),
        })),

      setPlayState: (playState) => set({ playState }),

      setOnEnd: (cb) => set({ onEnd: cb }),

      setCurrentBook: (title, chapter, bookId) =>
        set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

      setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

      setChunkProgress: (index, total) => set({ currentChunkIndex: index, totalChunks: total }),

      jumpToChunk: (index: number) => {
        if (index < 0 || index >= _sessionSegments.length) return;
        const config = normalizeTTSConfig(get().config);
        getSystemTTS().stop();
        getEdgeTTS().stop();
        getDashScopeTTS().stop();

        _sessionCurrentIndex = index;
        _sessionGeneration += 1;
        const gen = _sessionGeneration;
        set({ playState: "loading", currentChunkIndex: index });

        const remainingSegments = _sessionSegments.slice(index);
        if (remainingSegments.length === 0) {
          set({ playState: "stopped" });
          return;
        }

        const onState = (state: "playing" | "paused" | "stopped") => {
          if (gen !== _sessionGeneration) return;
          set({ playState: state });
        };
        const onChunk = (chunkIdx: number) => {
          if (gen !== _sessionGeneration) return;
          const absoluteIndex = index + chunkIdx;
          _sessionCurrentIndex = absoluteIndex;
          set({ currentChunkIndex: absoluteIndex, totalChunks: _sessionSegments.length });
        };
        const handleEnd = () => {
          if (gen !== _sessionGeneration) return;
          get().onEnd?.();
        };

        if (config.engine === "dashscope" && config.dashscopeApiKey) {
          const player = getDashScopeTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(remainingSegments, config);
        } else if (config.engine === "edge") {
          const player = getEdgeTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(remainingSegments, config);
        } else {
          const player = getSystemTTS();
          player.onStateChange = onState;
          player.onChunkChange = onChunk;
          player.onEnd = handleEnd;
          player.speak(remainingSegments, config);
        }
      },

      setSleepTimer: (minutes: number) => {
        const durationMinutes = Math.max(1, Math.round(minutes));
        const endsAt = Date.now() + durationMinutes * 60_000;
        clearSleepTimerHandle();
        _sleepTimerHandle = setTimeout(() => {
          _sleepTimerHandle = null;
          if (get().sleepTimerEndsAt !== endsAt) return;
          set({
            sleepTimerEndsAt: null,
            sleepTimerDurationMinutes: null,
          });
          get().pause();
        }, durationMinutes * 60_000);
        set({
          sleepTimerEndsAt: endsAt,
          sleepTimerDurationMinutes: durationMinutes,
        });
      },

      clearSleepTimer: () => {
        clearSleepTimerHandle();
        set({
          sleepTimerEndsAt: null,
          sleepTimerDurationMinutes: null,
        });
      },
    }),
    {
      playState: "stopped" as const,
      currentText: "",
      currentChunkIndex: 0,
      totalChunks: 0,
      currentLocationCfi: "",
      sleepTimerEndsAt: null,
      sleepTimerDurationMinutes: null,
    } as Partial<TTSState>,
    (persisted) => ({
      ...persisted,
      config: normalizeTTSConfig((persisted as TTSState).config),
    }),
  ),
);
