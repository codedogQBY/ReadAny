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
import {
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  shouldRespeakForSynthChange,
} from "../tts/respeak";
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
let _activeTTS: ITTSPlayer | null = null;
let _sessionSegments: string[] = [];
let _sessionCurrentIndex = 0;
/** Generation counter — incremented on every play/jumpToChunk to invalidate stale callbacks */
let _sessionGeneration = 0;
let _sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
/** Voice the active DashScope run is synthesizing with; lets resume() decide whether
 *  it can true-resume (voice unchanged) or must re-speak (voice changed). */
let _dashscopeActiveVoice: string | undefined;

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

let _respeakTimer: ReturnType<typeof setTimeout> | null = null;

function clearRespeakTimer(): void {
  if (_respeakTimer) {
    clearTimeout(_respeakTimer);
    _respeakTimer = null;
  }
}

function scheduleRespeak(): void {
  clearRespeakTimer();
  _respeakTimer = setTimeout(() => {
    _respeakTimer = null;
    const { playState, jumpToChunk } = useTTSStore.getState();
    if (isActivePlay(playState)) {
      jumpToChunk(_sessionCurrentIndex);
    }
  }, VOICE_RESPEAK_DEBOUNCE_MS);
}

function detachAndStopPlayer(player: ITTSPlayer | null): void {
  if (!player) return;
  player.onStateChange = undefined;
  player.onChunkChange = undefined;
  player.onEnd = undefined;
  try {
    player.stop();
  } catch (err) {
    console.warn("[TTS] Failed to stop player:", err);
  }
}

function detachAndStopAllPlayers(): void {
  _activeTTS = null;
  detachAndStopPlayer(_systemTTS);
  detachAndStopPlayer(_edgeTTS);
  detachAndStopPlayer(_dashscopeTTS);
}

function getPlayerForConfig(config: TTSConfig): ITTSPlayer {
  if (config.engine === "dashscope" && config.dashscopeApiKey) {
    return getDashScopeTTS();
  }
  if (config.engine === "edge") {
    return getEdgeTTS();
  }
  return getSystemTTS();
}

function startPlayback(
  segments: string[],
  config: TTSConfig,
  startIndex: number,
  set: (partial: Partial<TTSState>) => void,
  get: () => TTSState,
): void {
  const player = getPlayerForConfig(config);
  const gen = _sessionGeneration;
  _activeTTS = player;

  player.onStateChange = (playState) => {
    if (gen !== _sessionGeneration) return;
    if (playState === "stopped") {
      _activeTTS = null;
    }
    set({ playState });
  };

  player.onChunkChange = (chunkIndex, total) => {
    if (gen !== _sessionGeneration) return;
    const absoluteIndex = startIndex + chunkIndex;
    _sessionCurrentIndex = absoluteIndex;
    set({
      currentChunkIndex: absoluteIndex,
      totalChunks: Math.max(_sessionSegments.length, total),
    });
  };

  player.onEnd = () => {
    if (gen !== _sessionGeneration) return;
    _activeTTS = null;
    const lastIndex = Math.max(0, _sessionSegments.length - 1);
    _sessionCurrentIndex = lastIndex;
    set({
      playState: "stopped",
      currentChunkIndex: lastIndex,
      totalChunks: _sessionSegments.length,
    });
    get().onEnd?.();
  };

  const playback = player.speak(segments, config);
  void Promise.resolve(playback).catch((error) => {
    if (gen !== _sessionGeneration) return;
    console.error("[TTS] play failed:", error);
    _activeTTS = null;
    set({ playState: "stopped" });
  });
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
        clearRespeakTimer();
        const config = normalizeTTSConfig(get().config);
        _dashscopeActiveVoice = config.dashscopeVoice;
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
        detachAndStopAllPlayers();
        set({
          playState: "loading",
          currentText: sessionSegments.join(" "),
          currentChunkIndex: 0,
          totalChunks: sessionSegments.length,
        });

        startPlayback(sessionSegments, config, 0, set, get);
      },

      pause: () => {
        clearRespeakTimer();
        const { playState } = get();
        if (playState !== "playing") return;
        _activeTTS?.pause();
        set({ playState: "paused" });
      },

      resume: () => {
        const config = normalizeTTSConfig(get().config);
        const { playState } = get();
        if (playState !== "paused") return;

        // DashScope supports true suspend/resume and derives progress from the audio
        // clock (#358), so if it is actually suspended, continue exactly where paused —
        // no re-synthesis, no API re-call, no jump. Do NOT bump generation or rebind
        // callbacks; the original speak()'s callbacks keep driving progress.
        // Edge is intentionally NOT true-resumed here: its highlight notifications are
        // wall-clock timers cleared on pause and not rescheduled on resume, so a true
        // resume would skip highlights — it stays on the re-speak path below (its main behavior).
        if (config.engine === "dashscope" && config.dashscopeApiKey) {
          const player = getDashScopeTTS();
          if (player.paused && config.dashscopeVoice === _dashscopeActiveVoice) {
            player.resume();
            set({ playState: "playing" });
            return;
          }
        }

        if (_sessionSegments.length > 0) {
          const nextIndex = Math.max(
            0,
            Math.min(_sessionCurrentIndex, _sessionSegments.length - 1),
          );
          const remainingSegments = _sessionSegments.slice(nextIndex);
          if (remainingSegments.length > 0) {
            _sessionGeneration += 1;
            detachAndStopAllPlayers();
            _sessionCurrentIndex = nextIndex;
            _dashscopeActiveVoice = config.dashscopeVoice;
            set({
              playState: "loading",
              currentChunkIndex: nextIndex,
              totalChunks: _sessionSegments.length,
            });
            startPlayback(remainingSegments, config, nextIndex, set, get);
            return;
          }
        }
        set({ playState: "stopped" });
      },

      stop: () => {
        clearSleepTimerHandle();
        clearRespeakTimer();
        _sessionGeneration += 1;
        detachAndStopAllPlayers();
        _sessionSegments = [];
        _sessionCurrentIndex = 0;
        _dashscopeActiveVoice = undefined;
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

      updateConfig: (updates) => {
        const previousConfig = normalizeTTSConfig(get().config);
        const nextConfig = normalizeTTSConfig({ ...previousConfig, ...updates });
        const engineChanged =
          updates.engine !== undefined && nextConfig.engine !== previousConfig.engine;
        const wasPlaying = isActivePlay(get().playState);
        set({ config: nextConfig });

        if (engineChanged && wasPlaying) {
          clearRespeakTimer();
          _sessionGeneration += 1;
          detachAndStopAllPlayers();
          _dashscopeActiveVoice = undefined;
          set({ playState: "stopped" });
          return;
        }

        if (
          shouldRespeakForSynthChange(previousConfig, nextConfig) &&
          isActivePlay(get().playState)
        ) {
          scheduleRespeak();
        } else {
          // 非重读变更（切引擎、或改了当前引擎不关心的字段）必须取消上一次合成变更排下的
          // 待执行 respeak，否则陈旧防抖定时器会 fire 并强制重启播放。
          clearRespeakTimer();
        }
      },

      setPlayState: (playState) => set({ playState }),

      setOnEnd: (cb) => set({ onEnd: cb }),

      setCurrentBook: (title, chapter, bookId) =>
        set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

      setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

      setChunkProgress: (index, total) => set({ currentChunkIndex: index, totalChunks: total }),

      jumpToChunk: (index: number) => {
        clearRespeakTimer();
        if (index < 0 || index >= _sessionSegments.length) return;
        const config = normalizeTTSConfig(get().config);
        const remainingSegments = _sessionSegments.slice(index);
        if (remainingSegments.length === 0) {
          set({ playState: "stopped" });
          return;
        }

        _sessionGeneration += 1;
        detachAndStopAllPlayers();
        _dashscopeActiveVoice = config.dashscopeVoice;
        _sessionCurrentIndex = index;
        set({
          playState: "loading",
          currentChunkIndex: index,
          totalChunks: _sessionSegments.length,
        });

        startPlayback(remainingSegments, config, index, set, get);
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
